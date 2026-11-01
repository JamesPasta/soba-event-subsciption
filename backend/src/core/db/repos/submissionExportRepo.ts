import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  DEFAULT_SORT_LOCALE,
  SUBMISSION_EXPORT_STATES,
  type SUBMISSION_EXPORT_SORT_FIELDS,
  type SortToken,
} from '@soba/lib';
import { quietDb, type DbOrTx } from '../client';
import { readListPage } from '../listRead';
import { orderByForSort, type SortColumns } from '../listSort';
import {
  FormVersionState,
  JobStatus,
  JobType,
  PUBLIC_PROVIDER_CODE,
  SubmissionExportAuditAction,
  type SubmissionExportAuditActionCode,
} from '../codes';
import {
  appUsers,
  files,
  formVersions,
  forms,
  jobs,
  submissionExportAudits,
  submissions,
  userIdentities,
} from '../schema';
import { jobOutputColumns, onResultFile, type JobOutputRow } from './jobOutputRepo';
import { insertJob } from './jobRepo';
import { liveForm, liveSubmission } from './liveRows';

/** First int for `pg_advisory_xact_lock` on a form's exports; no other lock uses it. */
const ADV_LOCK_SUBMISSION_EXPORT_START = 1_703_221_419;

export interface NewExportJob {
  workspaceId: string;
  formId: string;
  actorId: string;
  format: string;
  params: Record<string, unknown>;
  maxAttempts: number;
  activeLimit: number;
  requestId: string | null;
}

/** The form's queued and running exports, whoever started them. */
export const activeExportsOf = (formId: string) =>
  and(
    eq(jobs.type, JobType.submission_export),
    eq(jobs.formId, formId),
    inArray(jobs.status, [JobStatus.queued, JobStatus.running]),
  );

/**
 * Queue an export job and audit its start, unless the form already has `activeLimit` queued or
 * running. A lock on the form makes two starts at once count one after the other.
 */
export const startExportJob = (input: NewExportJob): Promise<{ jobId: string } | 'limit_reached'> =>
  quietDb.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${ADV_LOCK_SUBMISSION_EXPORT_START}, hashtext(${input.formId}::text))`,
    );
    const [active] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(activeExportsOf(input.formId));
    if ((active?.count ?? 0) >= input.activeLimit) return 'limit_reached';
    const jobId = await insertJob(tx, {
      type: JobType.submission_export,
      workspaceId: input.workspaceId,
      formId: input.formId,
      createdBy: input.actorId,
      params: input.params,
      maxAttempts: input.maxAttempts,
    });
    if (!jobId) throw new Error('Export job not queued');
    await insertExportAudit(tx, {
      workspaceId: input.workspaceId,
      formId: input.formId,
      jobId,
      action: SubmissionExportAuditAction.started,
      format: input.format,
      actorId: input.actorId,
      requestId: input.requestId,
    });
    return { jobId };
  });

export interface ExportAuditRow {
  workspaceId: string;
  formId: string;
  jobId: string;
  fileId?: string | null;
  action: SubmissionExportAuditActionCode;
  format: string;
  rowCount?: number | null;
  unreadCount?: number | null;
  size?: number | null;
  actorId: string;
  requestId: string | null;
}

export const insertExportAudit = async (dbOrTx: DbOrTx, row: ExportAuditRow): Promise<void> => {
  await dbOrTx.insert(submissionExportAudits).values({
    workspaceId: row.workspaceId,
    formId: row.formId,
    jobId: row.jobId,
    fileId: row.fileId ?? null,
    action: row.action,
    format: row.format,
    rowCount: row.rowCount ?? null,
    unreadCount: row.unreadCount ?? null,
    size: row.size ?? null,
    requestId: row.requestId,
    createdBy: row.actorId,
  });
};

/** An export as its starter sees it: the job, what it produced, and how its run finished. */
export type ExportJobRow = JobOutputRow & {
  workspaceId: string;
  formId: string;
  params: Record<string, unknown>;
  createdAt: Date;
  finishedAt: Date | null;
  cancelRequestedAt: Date | null;
  lastError: string | null;
  rowCount: number | null;
  unreadCount: number | null;
};

/**
 * A count from the finished audit row of the file the job points at. A run that lost its lease after
 * storing writes its own row for a file a later run replaced.
 */
const finishedCount = (column: AnyPgColumn) =>
  sql<
    number | null
  >`(select max(${column}) from ${submissionExportAudits} where ${submissionExportAudits.jobId} = ${jobs.id} and ${submissionExportAudits.action} = ${SubmissionExportAuditAction.finished} and ${submissionExportAudits.fileId} = ${jobs.resultFileId})`;

const exportColumns = {
  ...jobOutputColumns,
  workspaceId: jobs.workspaceId,
  formId: sql<string>`${jobs.formId}`,
  params: jobs.params,
  createdAt: jobs.createdAt,
  finishedAt: jobs.finishedAt,
  cancelRequestedAt: jobs.cancelRequestedAt,
  lastError: jobs.lastError,
  rowCount: finishedCount(submissionExportAudits.rowCount),
  unreadCount: finishedCount(submissionExportAudits.unreadCount),
};

/** The person's own exports of the form; nobody else's, and no other kind of job. */
export const ownExports = (formId: string, actorId: string) =>
  and(
    eq(jobs.type, JobType.submission_export),
    eq(jobs.formId, formId),
    eq(jobs.createdBy, actorId),
  );

const EXPORT_SORT_COLUMNS: SortColumns<(typeof SUBMISSION_EXPORT_SORT_FIELDS)[number]> = {
  createdAt: { column: jobs.createdAt },
};

export interface ExportListQuery {
  offset: number;
  limit: number;
  sort: SortToken<(typeof SUBMISSION_EXPORT_SORT_FIELDS)[number]>;
}

/** One page of the person's exports of the form, and how many there are. */
export const listExportJobs = (
  formId: string,
  actorId: string,
  query: ExportListQuery,
): Promise<{ items: ExportJobRow[]; total: number }> =>
  readListPage(async (tx) => {
    const items = await tx
      .select(exportColumns)
      .from(jobs)
      .leftJoin(files, onResultFile)
      .where(ownExports(formId, actorId))
      .orderBy(...orderByForSort(EXPORT_SORT_COLUMNS, query.sort, jobs.id, DEFAULT_SORT_LOCALE))
      .limit(query.limit)
      .offset(query.offset);
    const [totals] = await tx
      .select({ total: count() })
      .from(jobs)
      .where(ownExports(formId, actorId));
    return { items, total: totals?.total ?? 0 };
  });

/** One of the person's exports of the form; null for anyone else's, or any other job. */
export const getExportJob = async (
  formId: string,
  actorId: string,
  jobId: string,
): Promise<ExportJobRow | null> => {
  const [row] = await quietDb
    .select(exportColumns)
    .from(jobs)
    .leftJoin(files, onResultFile)
    .where(and(eq(jobs.id, jobId), ownExports(formId, actorId)));
  return row ?? null;
};

/** Whether the version belongs to the form. */
export const isVersionOfForm = async (formId: string, versionId: string): Promise<boolean> => {
  const [row] = await quietDb
    .select({ id: formVersions.id })
    .from(formVersions)
    .where(and(eq(formVersions.id, versionId), eq(formVersions.formId, formId)));
  return row !== undefined;
};

/** The form's name and workspace while it is live; null once deleted. */
export const getLiveForm = async (
  formId: string,
): Promise<{ name: string; workspaceId: string } | null> => {
  const [row] = await quietDb
    .select({ name: forms.name, workspaceId: forms.workspaceId })
    .from(forms)
    .where(and(eq(forms.id, formId), liveForm));
  return row ?? null;
};

/**
 * The form's published and archived versions' engine schema refs, newest version first; only
 * `formVersionId`'s when given. Drafts, deleted versions and versions not in the engine are left out.
 */
export const exportSchemaRefs = async (
  workspaceId: string,
  formId: string,
  formVersionId?: string,
): Promise<string[]> => {
  const rows = await quietDb
    .select({ ref: sql<string>`${formVersions.engineSchemaRef}` })
    .from(formVersions)
    .where(
      and(
        eq(formVersions.workspaceId, workspaceId),
        eq(formVersions.formId, formId),
        formVersionId ? eq(formVersions.id, formVersionId) : undefined,
        inArray(formVersions.state, [FormVersionState.published, FormVersionState.archived]),
        isNull(formVersions.deletedAt),
        isNotNull(formVersions.engineSchemaRef),
      ),
    )
    .orderBy(desc(formVersions.versionNo));
  return rows.map((row) => row.ref);
};

/** Which of a form's submissions an export reads. */
export interface ExportSubmissionRange {
  workspaceId: string;
  formId: string;
  /** Absent means every version. */
  formVersionId?: string;
  /** Submitted in [from, to). */
  from?: Date;
  to: Date;
}

/** Where an export page ended: its last submission's time, as Postgres wrote it, and id. */
export interface ExportSubmissionCursor {
  submittedAt: string;
  submissionId: string;
}

/** Shown as the submitter of an anonymous submission. */
export const PUBLIC_SUBMITTER = 'public';

/**
 * The form's live submissions in an exported state, submitted in the range. Expects `forms` and
 * `formVersions` joined.
 */
export const exportSubmissionsWhere = (range: ExportSubmissionRange) =>
  and(
    eq(submissions.workspaceId, range.workspaceId),
    eq(submissions.formId, range.formId),
    range.formVersionId ? eq(submissions.formVersionId, range.formVersionId) : undefined,
    inArray(submissions.workflowState, [...SUBMISSION_EXPORT_STATES]),
    range.from ? gte(submissions.submittedAt, range.from) : undefined,
    lt(submissions.submittedAt, range.to),
    liveSubmission,
  );

/**
 * After the cursor in submission order. The time is compared as Postgres wrote it, as a JS date
 * would drop its microseconds and read the same row again.
 */
export const afterExportSubmission = (cursor: ExportSubmissionCursor) =>
  sql`(${submissions.submittedAt}, ${submissions.id}) > (${cursor.submittedAt}::timestamptz, ${cursor.submissionId}::uuid)`;

export interface ExportSubmissionRow {
  submissionId: string;
  confirmationCode: string;
  versionId: string;
  submittedAt: Date;
  /** `submittedAt` as Postgres wrote it, for the next page's cursor. */
  submittedAtText: string;
  /** The submitter's display label, or `public` for an anonymous submission. */
  submitter: string;
  /** The submitter's username, else display label; blank for an anonymous submission. */
  username: string;
  /** The submitter's email; blank for an anonymous submission. */
  email: string;
  engineSchemaRef: string | null;
  engineSubmissionRef: string | null;
}

export const exportSubmissionColumns = {
  submissionId: submissions.id,
  confirmationCode: submissions.confirmationCode,
  versionId: submissions.formVersionId,
  // The range only matches submitted rows, so the time is always there.
  submittedAt: sql<Date>`${submissions.submittedAt}`.mapWith(submissions.submittedAt),
  submittedAtText: sql<string>`${submissions.submittedAt}::text`,
  submitter: sql<string>`case when ${appUsers.id} is null or ${userIdentities.id} is not null then ${PUBLIC_SUBMITTER} else coalesce(${appUsers.displayLabel}, '') end`,
  username: sql<string>`case when ${appUsers.id} is null or ${userIdentities.id} is not null then '' else coalesce(${appUsers.profile}->>'preferredUsername', ${appUsers.displayLabel}, '') end`,
  email: sql<string>`case when ${appUsers.id} is null or ${userIdentities.id} is not null then '' else coalesce(${appUsers.profile}->>'email', '') end`,
  engineSchemaRef: formVersions.engineSchemaRef,
  engineSubmissionRef: submissions.engineSubmissionRef,
};

/** One page of the range's submissions in submission order, after the cursor when given. */
export const readExportSubmissionPage = (
  range: ExportSubmissionRange,
  after: ExportSubmissionCursor | null,
  limit: number,
): Promise<ExportSubmissionRow[]> =>
  quietDb
    .select(exportSubmissionColumns)
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
    .leftJoin(appUsers, eq(appUsers.id, submissions.submittedBy))
    .leftJoin(
      userIdentities,
      and(
        eq(userIdentities.userId, submissions.submittedBy),
        eq(userIdentities.identityProviderCode, PUBLIC_PROVIDER_CODE),
      ),
    )
    .where(and(exportSubmissionsWhere(range), after ? afterExportSubmission(after) : undefined))
    .orderBy(asc(submissions.submittedAt), asc(submissions.id))
    .limit(limit);

/** How many submissions the range covers. */
export const countExportSubmissions = async (range: ExportSubmissionRange): Promise<number> => {
  const [row] = await quietDb
    .select({ total: count() })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
    .where(exportSubmissionsWhere(range));
  return row?.total ?? 0;
};
