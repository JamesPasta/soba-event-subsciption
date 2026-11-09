import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { addAbortSignal } from 'node:stream';
import type { Logger } from 'pino';
import type { JobSettings } from '../config/env';
import type { FileRecord } from '../db/repos/fileRepo';
import { attachJobResult, type ClaimedJob, type JobProgress } from '../db/repos/jobRepo';
import type { TempResource } from '../integrations/temp-storage/TempStorageAdapter';
import { fileStore } from '../services/fileStore';
import type { StoredJobResult } from './registry';
import { JobCancelledError, JobFailedError } from './settlement';

/** progress_done and progress_total are integer columns. */
const MAX_COUNT = 2_147_483_647;

const wholeCount = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), MAX_COUNT) : 0;

/**
 * Keeps a job's latest progress and writes it at most every `intervalMs`, one write at a time. A
 * value reported between writes waits for the next report after the interval, or the outcome.
 */
export const createProgressReporter = (
  write: (progress: JobProgress) => Promise<boolean>,
  intervalMs: number,
  log: Logger,
  now: () => number = Date.now,
) => {
  let latest: JobProgress | undefined;
  let writtenAt = Number.NEGATIVE_INFINITY;
  let writing = false;
  return {
    report(done: number, total: number | null = null): void {
      latest = { done: wholeCount(done), total: total === null ? null : wholeCount(total) };
      if (writing || now() - writtenAt < intervalMs) return;
      writing = true;
      writtenAt = now();
      write(latest)
        .catch((err: unknown) => log.warn({ err }, 'Job progress not written'))
        .finally(() => {
          writing = false;
        });
    },
    latest: (): JobProgress | undefined => latest,
  };
};

const NOT_STORED = 'Stopped before its result was stored';

/** The error for a stop seen while storing; the signal's reason is the runner's stop reason. */
const stoppedError = (signal: AbortSignal): Error =>
  signal.reason === 'cancel' ? new JobCancelledError(NOT_STORED) : new Error(NOT_STORED);

/**
 * Upload a staged file and make it the job's result. Over the size limit the job fails for good.
 * The file row and the job's pointer are written together, fenced by the claim token, and the
 * earlier result's row goes with them; its bytes are deleted after.
 */
export const storeJobResult = async (
  job: ClaimedJob,
  staged: TempResource,
  meta: { filename: string; contentType: string },
  settings: JobSettings,
  signal: AbortSignal,
): Promise<StoredJobResult> => {
  if (signal.aborted) throw stoppedError(signal);
  const { size } = await stat(staged.path);
  if (size > settings.resultMaxBytes) {
    throw new JobFailedError(`Result over the size limit of ${settings.resultMaxBytes} bytes`);
  }
  // Set inside the record write's transaction.
  const attach: {
    refused?: 'not_held' | 'cancel_requested';
    previous: FileRecord | null;
  } = { previous: null };
  const source = addAbortSignal(signal, createReadStream(staged.path));
  let record: FileRecord;
  try {
    record = await fileStore.putGenerated(
      {
        workspaceId: job.workspaceId,
        actorId: job.createdBy,
        profile: settings.resultsStorageProfile,
        prefix: settings.resultsStoragePrefix,
        filename: meta.filename,
        contentType: meta.contentType,
        size,
        stream: source,
      },
      async (tx, file) => {
        const outcome = await attachJobResult(
          tx,
          job.id,
          job.claimToken,
          file.id,
          settings.resultRetentionDays,
        );
        if (outcome.attached === false) {
          attach.refused = outcome.reason;
          throw new Error('Result not attached');
        }
        attach.previous = outcome.previous;
      },
    );
  } catch (err) {
    // An upload that failed before reading would otherwise hold the staged file open.
    source.destroy();
    if (attach.refused === 'cancel_requested') throw new JobCancelledError(NOT_STORED);
    if (attach.refused === 'not_held') throw new Error('Job no longer held; result not stored');
    if (signal.aborted) throw stoppedError(signal);
    throw err;
  }
  if (attach.previous) await fileStore.deleteBytes(attach.previous);
  return { fileId: record.id, size };
};
