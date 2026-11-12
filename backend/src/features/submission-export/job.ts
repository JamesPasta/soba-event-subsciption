import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { hasAllPermissions, SUBMISSION_EXPORT_LAYOUTS } from '@soba/lib';
import { env, JobPool } from '../../core/config/env';
import { quietDb } from '../../core/db/client';
import { Features, JobType, Permissions, SubmissionExportAuditAction } from '../../core/db/codes';
import { isFeatureEnabledCached } from '../../core/db/repos/featureRepo';
import { resolveFormPermissions } from '../../core/db/repos/formAccessRepo';
import { getLiveForm, insertExportAudit } from '../../core/db/repos/submissionExportRepo';
import { getTempStorageAdapter } from '../../core/integrations/plugins/PluginRegistry';
import type { JobContext, JobTypeDefinition } from '../../core/jobs/registry';
import { JobCancelledError, JobFailedError } from '../../core/jobs/settlement';
import { log } from '../../core/logging';
import { engineExportSource, exportSchemas, formAnswerReader } from './engineSource';
import { staffFileLinked } from './fileLinks';
import { exportFormat } from './formats';
import { exportFieldNames } from './schemaFields';
import { sizeLimit } from './sizeLimit';
import { exportBoundsOf } from './source';
import { submissionExportQuery } from './submissionQuery';

export const SUBMISSION_EXPORT_MAX_ATTEMPTS = 3;

/**
 * Recorded as the job's error. The export routes read lost access and the size limit
 * (`EXPORT_TOO_LARGE`) as why the export ended; anything else, the feature turned off included,
 * reads as an error.
 */
export const EXPORT_ACCESS_LOST = "The export's starter can no longer read the form's submissions";
export const EXPORT_TURNED_OFF = 'Submission export is turned off';

const PAGE_SIZE = 100;

/** What the start route fixed: the filters and the bounds. */
export const ExportParamsSchema = z.object({
  format: z.enum(['csv', 'json']),
  layout: z.enum(SUBMISSION_EXPORT_LAYOUTS).optional(),
  fields: z.array(z.string()).optional(),
  formVersionId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }),
});
export type ExportParams = z.infer<typeof ExportParamsSchema>;

/** Counts each row as it passes, for progress. */
async function* counting<T>(rows: AsyncIterable<T>, onRow: () => void): AsyncIterable<T> {
  for await (const row of rows) {
    onRow();
    yield row;
  }
}

const DATE_IN_BC = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The form's name and the day the export was started, without characters file systems refuse. */
export const exportFileName = (formName: string, startedAt: Date, extension: string): string => {
  // eslint-disable-next-line no-control-regex
  const name = formName.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
  return `${name.trim().slice(0, 100) || 'Submissions'} ${DATE_IN_BC.format(startedAt)}.${extension}`;
};

/** The starter still reads the form's submissions, and the form is live in the job's workspace. */
const starterStillReads = async (job: JobContext['job']): Promise<string | null> => {
  if (!job.formId) return null;
  const form = await getLiveForm(job.formId);
  if (form?.workspaceId !== job.workspaceId) return null;
  const permissions = await resolveFormPermissions(job.createdBy, job.workspaceId, job.formId);
  return hasAllPermissions(permissions, [Permissions.submission_read]) ? form.name : null;
};

/**
 * The form's name, when exports are on and the starter may still read its submissions; otherwise
 * the export ends cancelled. Checked before reading and again before the file is stored, as a run
 * can take long enough for either to change.
 */
const stillAllowed = async (job: JobContext['job']): Promise<string> => {
  if (!(await isFeatureEnabledCached(Features.submission_export, Date.now()))) {
    throw new JobCancelledError(EXPORT_TURNED_OFF);
  }
  const formName = await starterStillReads(job);
  if (formName === null) throw new JobCancelledError(EXPORT_ACCESS_LOST);
  return formName;
};

const runExport = async ({
  job,
  signal,
  reportProgress,
  resultMaxBytes,
  storeResult,
}: JobContext): Promise<void> => {
  const parsed = ExportParamsSchema.safeParse(job.params);
  if (!parsed.success) throw new JobFailedError('Export settings are not readable');
  const params = parsed.data;
  if (!job.formId) throw new JobFailedError('Export has no form');
  await stillAllowed(job);

  const format = exportFormat(params.format);
  const bounds = exportBoundsOf(job.workspaceId, job.formId, params);
  const schemas = await exportSchemas(job.workspaceId, job.formId, params.formVersionId);
  const source = engineExportSource(
    submissionExportQuery,
    await formAnswerReader(job.workspaceId, job.formId),
  );
  const temp = getTempStorageAdapter();
  const staged = temp.reserve({ prefix: 'export' });
  try {
    const total = await source.count(bounds);
    reportProgress(0, total);
    let done = 0;
    let unread = 0;
    // A submission that could not be read is passed over, so it counts toward progress too.
    const progress = () => reportProgress(done + unread, total);
    const rows = counting(
      source.rows(bounds, {
        pageSize: PAGE_SIZE,
        signal,
        onUnread: (count) => {
          unread += count;
          progress();
        },
      }),
      () => {
        done += 1;
        progress();
      },
    );
    const designerUrl = env.getDesignerAppUrl();
    if (!designerUrl)
      log.warn({ jobId: job.id }, 'DESIGNER_APP_URL unset; export keeps stored file links');
    const text = format.serialize(staffFileLinked(rows, job.formId, designerUrl), {
      fields: params.fields ?? exportFieldNames(schemas),
      layout: params.layout,
      schemas,
      maxBytes: resultMaxBytes,
      signal,
    });
    await pipeline(Readable.from(text), sizeLimit(resultMaxBytes), createWriteStream(staged.path), {
      signal,
    });
    const formName = await stillAllowed(job);
    const stored = await storeResult(staged, {
      filename: exportFileName(formName, job.createdAt, format.extension),
      contentType: format.contentType,
    });
    await insertExportAudit(quietDb, {
      workspaceId: job.workspaceId,
      formId: job.formId,
      jobId: job.id,
      fileId: stored.fileId,
      action: SubmissionExportAuditAction.finished,
      format: params.format,
      rowCount: done,
      unreadCount: unread,
      size: stored.size,
      actorId: job.createdBy,
      requestId: null,
    });
  } catch (err) {
    // An export that ran out of time would run out again.
    if (signal.aborted && signal.reason === 'timeout') throw new JobFailedError('Timed out');
    throw err;
  } finally {
    await temp.remove(staged);
  }
};

export const submissionExportJob: JobTypeDefinition = {
  type: JobType.submission_export,
  pool: JobPool.heavy,
  maxAttempts: SUBMISSION_EXPORT_MAX_ATTEMPTS,
  run: runExport,
};
