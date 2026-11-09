import type { JobResult } from '@soba/lib';
import { JobStatus } from '../db/codes';
import type { FileRecord } from '../db/repos/fileRepo';
import { readJobOutputs, readJobResultFile, type JobOutputRow } from '../db/repos/jobOutputRepo';
import type { GetFileResult } from '../integrations/storage-engine/StorageEngineAdapter';
import { fileStore } from '../services/fileStore';

/** A succeeded job's result: ready to read until it expires. */
export type JobResultFacts =
  | {
      state: 'ready';
      filename: string;
      size: number | null;
      contentType: string | null;
      expiresAt: Date;
    }
  | { state: 'expired'; expiresAt: Date };

export interface JobOutput {
  progress: { done: number; total: number | null } | null;
  result: JobResultFacts | null;
}

/**
 * A result shows only on a succeeded job, and only the one the run that succeeded stored, until it
 * expires. A succeeded job past its expiry reads as expired whether or not the sweep has run.
 */
export const resultFacts = (row: JobOutputRow): JobResultFacts | null => {
  if (row.status !== JobStatus.succeeded || !row.resultExpiresAt) return null;
  if (row.resultExpired) return { state: 'expired', expiresAt: row.resultExpiresAt };
  if (!row.resultFileId || !row.resultFilename || !row.resultStoredThisRun) return null;
  return {
    state: 'ready',
    filename: row.resultFilename,
    size: row.resultSize,
    contentType: row.resultContentType,
    expiresAt: row.resultExpiresAt,
  };
};

/** The result's facts as the API returns them. */
export const toJobResult = (facts: JobResultFacts): JobResult =>
  facts.state === 'ready'
    ? {
        state: 'ready',
        expiresAt: facts.expiresAt.toISOString(),
        filename: facts.filename,
        size: facts.size,
        contentType: facts.contentType,
      }
    : { state: 'expired', expiresAt: facts.expiresAt.toISOString() };

export const toJobOutput = (row: JobOutputRow): JobOutput => ({
  progress: row.progressDone === null ? null : { done: row.progressDone, total: row.progressTotal },
  result: resultFacts(row),
});

/** Progress and result facts for each job found, by id. */
export const listJobOutputs = async (jobIds: string[]): Promise<Map<string, JobOutput>> => {
  const rows = await readJobOutputs(jobIds);
  return new Map(rows.map((row) => [row.jobId, toJobOutput(row)]));
};

export type OpenedJobResult =
  | { state: 'ready'; file: FileRecord; content: GetFileResult }
  | { state: 'expired' }
  | { state: 'none' };

/**
 * A job's result for download, when it is ready and its bytes are still stored. The caller checks
 * who may read it.
 */
export const openJobResult = async (jobId: string): Promise<OpenedJobResult> => {
  const found = await readJobResultFile(jobId);
  const facts = found ? resultFacts(found.output) : null;
  if (facts?.state === 'expired') return { state: 'expired' };
  if (facts?.state !== 'ready' || !found?.file) return { state: 'none' };
  const content = await fileStore.open(found.file);
  return content ? { state: 'ready', file: found.file, content } : { state: 'none' };
};
