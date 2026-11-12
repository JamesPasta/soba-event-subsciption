import {
  ApiErrorCodes,
  type StartSubmissionExportBody,
  type SubmissionExport,
  type SubmissionExportEndReason,
  type SubmissionExportFieldsBody,
  type SubmissionExportFieldsResponse,
  type SubmissionExportList,
  type SubmissionExportStatus,
} from '@soba/lib';
import { env } from '../../core/config/env';
import { quietDb } from '../../core/db/client';
import { JobStatus, JobType, SubmissionExportAuditAction } from '../../core/db/codes';
import { cancelJob } from '../../core/db/repos/jobRepo';
import {
  countExportSubmissions,
  getExportJob,
  insertExportAudit,
  isVersionOfForm,
  listExportJobs,
  startExportJob,
  type ExportJobRow,
  type ExportListQuery,
} from '../../core/db/repos/submissionExportRepo';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  ValidationError,
} from '../../core/errors';
import { nudgeJobs } from '../../core/jobs';
import { openJobResult, resultFacts, toJobResult } from '../../core/jobs/outputs';
import { getCorrelationId, log } from '../../core/logging';
import { exportSchemas } from './engineSource';
import {
  EXPORT_ACCESS_LOST,
  ExportParamsSchema,
  SUBMISSION_EXPORT_MAX_ATTEMPTS,
  type ExportParams,
} from './job';
import { exportFieldNames } from './schemaFields';
import { EXPORT_TOO_LARGE } from './sizeLimit';
import { exportBoundsOf } from './source';

/** Who is asking, about which form. */
export type ExportContext = { actorId: string; workspaceId: string; formId: string };

const NOT_FOUND = 'Export not found';

/** Where an export stands, and why it ended when it failed or was cancelled. */
export const exportStatusOf = (
  row: ExportJobRow,
): { status: SubmissionExportStatus; endReason?: SubmissionExportEndReason } => {
  switch (row.status) {
    case JobStatus.queued:
    case JobStatus.running:
      return { status: row.status };
    case JobStatus.succeeded: {
      const facts = resultFacts(row);
      if (facts) return { status: facts.state };
      log.warn({ jobId: row.jobId }, 'Export succeeded with no file');
      return { status: 'failed', endReason: 'error' };
    }
    case JobStatus.cancelled:
      if (row.cancelRequestedAt) return { status: 'cancelled', endReason: 'cancelled' };
      return {
        status: 'cancelled',
        endReason: row.lastError === EXPORT_ACCESS_LOST ? 'access_lost' : 'error',
      };
    default:
      return {
        status: 'failed',
        endReason: row.lastError?.startsWith(EXPORT_TOO_LARGE) ? 'too_large' : 'error',
      };
  }
};

/** The filters the export was started with; none when they cannot be read. */
const paramsOf = (row: ExportJobRow): Partial<ExportParams> => {
  const parsed = ExportParamsSchema.safeParse(row.params);
  return parsed.success ? parsed.data : {};
};

/** An export from its job: the filters it was started with, where it stands, and its file. */
export const toSubmissionExport = (row: ExportJobRow): SubmissionExport => {
  const params = paramsOf(row);
  const { status, endReason } = exportStatusOf(row);
  const result = resultFacts(row);
  return {
    format: params.format ?? 'csv',
    ...(params.layout ? { layout: params.layout } : {}),
    ...(params.fields ? { fields: params.fields } : {}),
    ...(params.formVersionId ? { formVersionId: params.formVersionId } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
    id: row.jobId,
    formId: row.formId,
    status,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    ...(row.progressDone === null
      ? {}
      : { progress: { done: row.progressDone, total: row.progressTotal } }),
    ...(endReason ? { endReason } : {}),
    ...(row.unreadCount === null ? {} : { unreadCount: row.unreadCount }),
    ...(result ? { result: toJobResult(result) } : {}),
  };
};

const requireOwnExport = async (ctx: ExportContext, exportId: string): Promise<ExportJobRow> => {
  const row = await getExportJob(ctx.formId, ctx.actorId, exportId);
  if (!row) throw new NotFoundError(NOT_FOUND);
  return row;
};

/** The submitted-in bounds: `to` no later than now, so a retry exports the same submissions. */
export const exportBounds = (
  body: SubmissionExportFieldsBody,
  now: Date,
): { from?: string; to: string } => {
  const requestedTo = body.to ? new Date(body.to) : now;
  const to = requestedTo < now ? requestedTo : now;
  if (body.from && new Date(body.from) >= to) {
    throw new ValidationError(
      'from must be before to, and before now',
      ApiErrorCodes.request_invalid,
    );
  }
  return {
    ...(body.from ? { from: new Date(body.from).toISOString() } : {}),
    to: to.toISOString(),
  };
};

export const submissionExportService = {
  /** The fields of the versions the filters cover, and how many submissions they cover. */
  async fields(
    ctx: ExportContext,
    body: SubmissionExportFieldsBody,
  ): Promise<SubmissionExportFieldsResponse> {
    const bounds = exportBoundsOf(ctx.workspaceId, ctx.formId, {
      formVersionId: body.formVersionId,
      ...exportBounds(body, new Date()),
    });
    const count = await countExportSubmissions(bounds);
    const schemas = await exportSchemas(ctx.workspaceId, ctx.formId, body.formVersionId);
    return { fields: exportFieldNames(schemas), count };
  },

  async list(ctx: ExportContext, query: ExportListQuery): Promise<SubmissionExportList> {
    const { items, total } = await listExportJobs(ctx.formId, ctx.actorId, query);
    return {
      items: items.map(toSubmissionExport),
      page: { offset: query.offset, limit: query.limit, total },
      sort: query.sort,
    };
  },

  async get(ctx: ExportContext, exportId: string): Promise<SubmissionExport> {
    return toSubmissionExport(await requireOwnExport(ctx, exportId));
  },

  /** Queue an export, unless the form already has as many running as allowed. */
  async start(ctx: ExportContext, body: StartSubmissionExportBody): Promise<SubmissionExport> {
    if (body.formVersionId && !(await isVersionOfForm(ctx.formId, body.formVersionId))) {
      throw new ValidationError(
        'That version is not one of this form',
        ApiErrorCodes.request_invalid,
      );
    }
    const params = {
      format: body.format,
      ...(body.layout ? { layout: body.layout } : {}),
      ...(body.fields ? { fields: body.fields } : {}),
      ...(body.formVersionId ? { formVersionId: body.formVersionId } : {}),
      ...exportBounds(body, new Date()),
    };
    const started = await startExportJob({
      workspaceId: ctx.workspaceId,
      formId: ctx.formId,
      actorId: ctx.actorId,
      format: body.format,
      params,
      maxAttempts: SUBMISSION_EXPORT_MAX_ATTEMPTS,
      activeLimit: env.getSubmissionExportActiveLimit(),
      requestId: getCorrelationId() ?? null,
    });
    if (started === 'limit_reached') {
      throw new TooManyRequestsError(
        'This form has as many exports running as allowed',
        ApiErrorCodes.export_limit_reached,
      );
    }
    log.info({ jobId: started.jobId, formId: ctx.formId, actorId: ctx.actorId }, 'Export started');
    nudgeJobs(JobType.submission_export);
    return toSubmissionExport(await requireOwnExport(ctx, started.jobId));
  },

  /**
   * Stop a queued or running export. A queued one is cancelled now; a running one is asked to stop,
   * and does unless it stored its file first. `stopped` is false while a running export has yet to
   * stop. One whose file is stored already has finished, as far as its starter is concerned.
   */
  async cancel(
    ctx: ExportContext,
    exportId: string,
  ): Promise<{ stopped: boolean; export: SubmissionExport }> {
    const row = await requireOwnExport(ctx, exportId);
    if (row.resultFileId && row.resultStoredThisRun) {
      throw new ConflictError('The export has finished');
    }
    const outcome = await cancelJob(row.workspaceId, exportId, { id: ctx.actorId, admin: false });
    if (outcome === 'not_active') throw new ConflictError('The export has finished');
    log.info({ jobId: exportId, formId: ctx.formId, actorId: ctx.actorId, outcome }, 'Export stop');
    return {
      stopped: outcome === 'cancelled',
      export: toSubmissionExport(await requireOwnExport(ctx, exportId)),
    };
  },

  /** The ready file, after recording the download; anything else is not found. */
  async openDownload(ctx: ExportContext, exportId: string) {
    const row = await requireOwnExport(ctx, exportId);
    const opened = await openJobResult(exportId);
    if (opened.state !== 'ready') {
      throw new NotFoundError('Export file not available', ApiErrorCodes.file_not_found);
    }
    try {
      await insertExportAudit(quietDb, {
        workspaceId: row.workspaceId,
        formId: row.formId,
        jobId: exportId,
        fileId: opened.file.id,
        action: SubmissionExportAuditAction.downloaded,
        format: paramsOf(row).format ?? 'csv',
        rowCount: row.rowCount,
        unreadCount: row.unreadCount,
        size: opened.file.size,
        actorId: ctx.actorId,
        requestId: getCorrelationId() ?? null,
      });
    } catch (err) {
      opened.content.downloadStream?.destroy();
      log.error({ err, jobId: exportId }, 'Export download not recorded; refused');
      throw new ServiceUnavailableError('The download could not be recorded; try again');
    }
    log.info({ jobId: exportId, formId: ctx.formId, actorId: ctx.actorId }, 'Export downloaded');
    return opened;
  },
};
