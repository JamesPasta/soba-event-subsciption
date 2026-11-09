import { and, count, eq, exists, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { DEFAULT_SORT_LOCALE, type JOB_SORT_FIELDS, type SortToken } from '@soba/lib';
import { db, quietDb } from '../client';
import { JobStatus, WorkspaceMembershipStatus } from '../codes';
import {
  appUsers,
  formVersions,
  forms,
  jobs,
  submissions,
  workspaceMemberships,
  workspaces,
} from '../schema';
import { readListPage } from '../listRead';
import { orderByForSort, type SortColumns } from '../listSort';
import { liveSubmission } from './liveRows';

/**
 * Which jobs a reader may see: every job, or the jobs the submissions of one workspace or one form
 * started. Every read and write here takes one, so a job outside it is not found.
 */
export type JobScope =
  | { kind: 'all' }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'form'; formId: string };

/** The condition a scope puts on every job query; none for every job. */
export const scopeWhere = (scope: JobScope): SQL | undefined => {
  if (scope.kind === 'all') return undefined;
  const id = scope.kind === 'form' ? scope.formId : scope.workspaceId;
  if (!id) throw new Error(`A ${scope.kind} job scope needs its id`);
  return and(
    scope.kind === 'form' ? eq(jobs.formId, id) : eq(jobs.workspaceId, id),
    isNotNull(jobs.submissionId),
  );
};

/** The scope's condition and the query's own, together. */
export const scoped = (scope: JobScope, ...conditions: (SQL | undefined)[]): SQL | undefined =>
  and(scopeWhere(scope), ...conditions);

export type JobListSortField = (typeof JOB_SORT_FIELDS)[number];

const JOB_SORT_COLUMNS: SortColumns<JobListSortField> = {
  createdAt: { column: jobs.createdAt },
  finishedAt: { column: jobs.finishedAt, nullable: true },
};

export interface JobListFilters {
  status?: string;
  type?: string;
  workspaceId?: string;
  formId?: string;
  submissionId?: string;
  offset: number;
  limit: number;
  sort: SortToken<JobListSortField>;
}

const listColumns = {
  id: jobs.id,
  type: jobs.type,
  status: jobs.status,
  attempts: jobs.attempts,
  maxAttempts: jobs.maxAttempts,
  workspaceId: jobs.workspaceId,
  workspaceName: workspaces.name,
  formId: jobs.formId,
  formName: forms.name,
  submissionId: jobs.submissionId,
  confirmationCode: submissions.confirmationCode,
  // Neither the submission, its form nor its form version deleted, so its page opens.
  submissionLive: sql<boolean>`(${and(isNotNull(submissions.id), liveSubmission)})`,
  createdAt: jobs.createdAt,
  runAfter: jobs.runAfter,
  finishedAt: jobs.finishedAt,
  cancelRequestedAt: jobs.cancelRequestedAt,
  requeueCount: jobs.requeueCount,
  lastError: jobs.lastError,
};

const summaryColumns = {
  id: jobs.id,
  type: jobs.type,
  status: jobs.status,
  createdAt: jobs.createdAt,
  finishedAt: jobs.finishedAt,
};

/** A job as a list reads it. */
export interface JobListRow {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  workspaceId: string;
  workspaceName: string;
  formId: string | null;
  formName: string | null;
  submissionId: string | null;
  confirmationCode: string | null;
  submissionLive: boolean;
  createdAt: Date;
  runAfter: Date;
  finishedAt: Date | null;
  cancelRequestedAt: Date | null;
  requeueCount: number;
  lastError: string | null;
}

/**
 * A person who acted on a job: whether they are an active member of its workspace now, and whether
 * they acted through the administration routes.
 */
export interface JobActorRow {
  id: string;
  displayLabel: string | null;
  member: boolean;
  viaAdmin: boolean;
}

/** A job as its page reads it. */
export interface JobRow extends JobListRow {
  revisionId: string | null;
  parentJobId: string | null;
  params: Record<string, unknown>;
  startedAt: Date | null;
  createdBy: { id: string; displayLabel: string | null };
  lastRequeuedAt: Date | null;
  lastRequeuedBy: JobActorRow | null;
  cancelRequestedBy: JobActorRow | null;
  childrenQueuedAt: Date | null;
}

/** A related job in brief. */
export interface JobSummaryRow {
  id: string;
  type: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
}

/** Jobs in the scope, newest first unless sorted otherwise, with workspace and form names. */
export const listJobs = async (
  scope: JobScope,
  filters: JobListFilters,
): Promise<{ items: JobListRow[]; total: number }> => {
  const where = scoped(
    scope,
    filters.status ? eq(jobs.status, filters.status) : undefined,
    filters.type ? eq(jobs.type, filters.type) : undefined,
    filters.workspaceId ? eq(jobs.workspaceId, filters.workspaceId) : undefined,
    filters.formId ? eq(jobs.formId, filters.formId) : undefined,
    filters.submissionId ? eq(jobs.submissionId, filters.submissionId) : undefined,
  );

  return readListPage(async (tx) => {
    const items = await tx
      .select(listColumns)
      .from(jobs)
      .innerJoin(workspaces, eq(workspaces.id, jobs.workspaceId))
      .leftJoin(forms, eq(forms.id, jobs.formId))
      .leftJoin(submissions, eq(submissions.id, jobs.submissionId))
      .leftJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
      .where(where)
      .orderBy(...orderByForSort(JOB_SORT_COLUMNS, filters.sort, jobs.id, DEFAULT_SORT_LOCALE))
      .limit(filters.limit)
      .offset(filters.offset);
    const totals = await tx.select({ total: count() }).from(jobs).where(where);
    return { items, total: totals[0]?.total ?? 0 };
  });
};

/** The forms that have jobs in the scope, by name. */
export const listJobForms = (scope: JobScope): Promise<{ id: string; name: string }[]> =>
  db
    .selectDistinct({ id: forms.id, name: forms.name })
    .from(jobs)
    .innerJoin(forms, eq(forms.id, jobs.formId))
    .where(scopeWhere(scope))
    .orderBy(forms.name, forms.id);

const createdByUser = alias(appUsers, 'created_by_user');
const requeuedByUser = alias(appUsers, 'requeued_by_user');
const cancelledByUser = alias(appUsers, 'cancelled_by_user');

/** The user is an active member of the job's workspace. */
const memberOfJobWorkspace = (userId: AnyPgColumn) =>
  sql<boolean>`${exists(
    db
      .select({ one: sql`1` })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, jobs.workspaceId),
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.status, WorkspaceMembershipStatus.active),
        ),
      ),
  )}`;

const actorOf = (
  id: string | null,
  displayLabel: string | null,
  member: boolean,
  viaAdmin: boolean,
): JobActorRow | null => (id ? { id, displayLabel, member, viaAdmin } : null);

/** One job in the scope with what its page shows; null when it is gone or outside the scope. */
export const getJob = async (scope: JobScope, id: string): Promise<JobRow | null> => {
  const [row] = await db
    .select({
      ...listColumns,
      revisionId: jobs.revisionId,
      parentJobId: jobs.parentJobId,
      params: jobs.params,
      startedAt: jobs.startedAt,
      createdById: jobs.createdBy,
      createdByLabel: createdByUser.displayLabel,
      lastRequeuedAt: jobs.lastRequeuedAt,
      lastRequeuedById: jobs.lastRequeuedBy,
      lastRequeuedByLabel: requeuedByUser.displayLabel,
      lastRequeuedByMember: memberOfJobWorkspace(jobs.lastRequeuedBy),
      lastRequeuedByAdmin: jobs.lastRequeuedByAdmin,
      cancelRequestedById: jobs.cancelRequestedBy,
      cancelRequestedByLabel: cancelledByUser.displayLabel,
      cancelRequestedByMember: memberOfJobWorkspace(jobs.cancelRequestedBy),
      cancelRequestedByAdmin: jobs.cancelRequestedByAdmin,
      childrenQueuedAt: jobs.childrenQueuedAt,
    })
    .from(jobs)
    .innerJoin(workspaces, eq(workspaces.id, jobs.workspaceId))
    .leftJoin(forms, eq(forms.id, jobs.formId))
    .leftJoin(submissions, eq(submissions.id, jobs.submissionId))
    .leftJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
    .innerJoin(createdByUser, eq(createdByUser.id, jobs.createdBy))
    .leftJoin(requeuedByUser, eq(requeuedByUser.id, jobs.lastRequeuedBy))
    .leftJoin(cancelledByUser, eq(cancelledByUser.id, jobs.cancelRequestedBy))
    .where(scoped(scope, eq(jobs.id, id)));
  if (!row) return null;
  const {
    createdById,
    createdByLabel,
    lastRequeuedById,
    lastRequeuedByLabel,
    lastRequeuedByMember,
    lastRequeuedByAdmin,
    cancelRequestedById,
    cancelRequestedByLabel,
    cancelRequestedByMember,
    cancelRequestedByAdmin,
    ...rest
  } = row;
  return {
    ...rest,
    createdBy: { id: createdById, displayLabel: createdByLabel },
    lastRequeuedBy: actorOf(
      lastRequeuedById,
      lastRequeuedByLabel,
      lastRequeuedByMember,
      lastRequeuedByAdmin,
    ),
    cancelRequestedBy: actorOf(
      cancelRequestedById,
      cancelRequestedByLabel,
      cancelRequestedByMember,
      cancelRequestedByAdmin,
    ),
  };
};

/** A related job in the scope in brief; null when it is gone. */
export const getJobSummary = async (scope: JobScope, id: string): Promise<JobSummaryRow | null> => {
  const [row] = await db
    .select(summaryColumns)
    .from(jobs)
    .where(scoped(scope, eq(jobs.id, id)));
  return row ?? null;
};

/** The jobs in the scope a job queued, oldest first. */
export const listChildJobs = (scope: JobScope, parentJobId: string): Promise<JobSummaryRow[]> =>
  db
    .select(summaryColumns)
    .from(jobs)
    .where(scoped(scope, eq(jobs.parentJobId, parentJobId)))
    .orderBy(jobs.createdAt, jobs.id);

/**
 * Run a dead or cancelled job in the scope again as the same row: queued now, attempts from zero,
 * its stop cleared. Its last error stays until the next outcome. Through the every-job scope, the
 * administration routes', the run is recorded as an administrator's. False when the job is neither
 * dead nor cancelled, such as after someone else ran it again.
 */
export const requeueJob = async (
  scope: JobScope,
  id: string,
  actorId: string,
): Promise<boolean> => {
  const rows = await quietDb
    .update(jobs)
    .set({
      status: JobStatus.queued,
      attempts: 0,
      runAfter: sql`now()`,
      claimToken: null,
      leaseUntil: null,
      cancelRequestedAt: null,
      cancelRequestedBy: null,
      cancelRequestedByAdmin: false,
      finishedAt: null,
      requeueCount: sql`${jobs.requeueCount} + 1`,
      lastRequeuedAt: sql`now()`,
      lastRequeuedBy: actorId,
      lastRequeuedByAdmin: scope.kind === 'all',
      progressDone: null,
      progressTotal: null,
      // A result left from an earlier run stays hidden until the new run replaces it.
      resultExpiresAt: sql`case when ${jobs.resultFileId} is null then null else ${jobs.resultExpiresAt} end`,
    })
    .where(
      scoped(scope, eq(jobs.id, id), inArray(jobs.status, [JobStatus.dead, JobStatus.cancelled])),
    )
    .returning({ id: jobs.id });
  return rows.length > 0;
};
