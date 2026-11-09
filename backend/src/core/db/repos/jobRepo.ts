import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { quietDb, type DbOrTx, type Tx } from '../client';
import { JobStatus } from '../codes';
import { files, jobs } from '../schema';
import type { FileRecord } from './fileRepo';

export type JobRecord = typeof jobs.$inferSelect;
/** A job this worker holds; every later write must match its claim token. */
export type ClaimedJob = JobRecord & { claimToken: string };

export interface NewJob {
  type: string;
  workspaceId: string;
  formId?: string | null;
  submissionId?: string | null;
  revisionId?: string | null;
  parentJobId?: string | null;
  actionConfigId?: string | null;
  createdBy: string;
  params?: Record<string, unknown>;
  dedupeKey?: string | null;
  maxAttempts: number;
}

/**
 * How a claimed job ends. A retry goes back to queued after the delay. A retry or dead job whose
 * cancel was requested meanwhile ends cancelled instead.
 */
export type JobFinish =
  | { kind: 'succeeded' }
  | { kind: 'cancelled'; error: string | null }
  | { kind: 'dead'; error: string }
  | { kind: 'retry'; delayMs: number; error: string };

export interface JobSweepResult {
  requeued: number;
  dead: number;
  cancelled: number;
  deleted: number;
}

export interface JobStats {
  /** Seconds the oldest due job has waited; null when none is waiting. */
  oldestQueuedSeconds: number | null;
  dead: number;
}

/** The error the sweeper records for a job whose worker stopped renewing its lease. */
export const LEASE_EXPIRED = 'Lease expired';

const afterMs = (ms: number): SQL => sql`now() + ${ms}::int * interval '1 millisecond'`;
const daysAgo = (days: number): SQL => sql`now() - ${days}::int * interval '1 day'`;

const held = (id: string, claimToken: string) =>
  and(eq(jobs.id, id), eq(jobs.claimToken, claimToken), eq(jobs.status, JobStatus.running));

const unclaimed = { claimToken: null, leaseUntil: null } as const;

const isClaimed = (row: JobRecord): row is ClaimedJob => row.claimToken !== null;

/** Queue a job in the caller's transaction. Null when its dedupe key is already taken. */
export const insertJob = async (dbOrTx: DbOrTx, input: NewJob): Promise<string | null> => {
  const [row] = await dbOrTx
    .insert(jobs)
    .values({
      type: input.type,
      status: JobStatus.queued,
      workspaceId: input.workspaceId,
      formId: input.formId ?? null,
      submissionId: input.submissionId ?? null,
      revisionId: input.revisionId ?? null,
      parentJobId: input.parentJobId ?? null,
      actionConfigId: input.actionConfigId ?? null,
      createdBy: input.createdBy,
      params: input.params ?? {},
      dedupeKey: input.dedupeKey ?? null,
      maxAttempts: input.maxAttempts,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return row?.id ?? null;
};

/**
 * Record, in the caller's transaction, that a held job queued its children. False when the job is no
 * longer this worker's, and the caller then rolls the children back.
 */
export const markChildrenQueued = async (
  dbOrTx: DbOrTx,
  id: string,
  claimToken: string,
): Promise<boolean> => {
  const rows = await dbOrTx
    .update(jobs)
    .set({ childrenQueuedAt: sql`now()` })
    .where(held(id, claimToken))
    .returning({ id: jobs.id });
  return rows.length > 0;
};

/**
 * Claim up to `limit` due jobs of the given types, oldest first. Rows another worker has locked are
 * skipped. The attempt is counted here, so a worker that dies mid-job still uses one up.
 */
export const claimJobs = async (
  types: string[],
  limit: number,
  leaseMs: number,
): Promise<ClaimedJob[]> => {
  if (types.length === 0 || limit < 1) return [];
  const due = quietDb
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, JobStatus.queued),
        inArray(jobs.type, types),
        lte(jobs.runAfter, sql`now()`),
      ),
    )
    .orderBy(jobs.runAfter)
    .limit(limit)
    .for('update', { skipLocked: true });
  const rows = await quietDb
    .update(jobs)
    .set({
      status: JobStatus.running,
      claimToken: sql`gen_random_uuid()`,
      attempts: sql`${jobs.attempts} + 1`,
      leaseUntil: afterMs(leaseMs),
      startedAt: sql`now()`,
      progressDone: null,
      progressTotal: null,
    })
    .where(inArray(jobs.id, due))
    .returning();
  return rows.filter(isClaimed);
};

export interface JobProgress {
  done: number;
  total: number | null;
}

/** Record how far a held job has got. False once the job is no longer this worker's. */
export const writeJobProgress = async (
  id: string,
  claimToken: string,
  progress: JobProgress,
): Promise<boolean> => {
  const rows = await quietDb
    .update(jobs)
    .set({ progressDone: progress.done, progressTotal: progress.total })
    .where(held(id, claimToken))
    .returning({ id: jobs.id });
  return rows.length > 0;
};

export type AttachResultOutcome =
  | { attached: true; previous: FileRecord | null }
  | { attached: false; reason: 'not_held' | 'cancel_requested' };

/**
 * Point a held job at its new result file, in the caller's transaction, and delete the row of the
 * file it pointed at before; the caller deletes that file's bytes after commit. Refused once the job
 * is no longer this worker's or a stop was asked for, so a stopped job never gains a result.
 */
export const attachJobResult = async (
  tx: Tx,
  id: string,
  claimToken: string,
  fileId: string,
  retentionDays: number,
): Promise<AttachResultOutcome> => {
  const [row] = await tx
    .select({ resultFileId: jobs.resultFileId, cancelRequestedAt: jobs.cancelRequestedAt })
    .from(jobs)
    .where(held(id, claimToken))
    .for('update');
  if (!row) return { attached: false, reason: 'not_held' };
  if (row.cancelRequestedAt) return { attached: false, reason: 'cancel_requested' };
  await tx
    .update(jobs)
    .set({
      resultFileId: fileId,
      resultExpiresAt: sql`now() + ${retentionDays}::int * interval '1 day'`,
    })
    .where(eq(jobs.id, id));
  if (!row.resultFileId) return { attached: true, previous: null };
  const [previous] = await tx.delete(files).where(eq(files.id, row.resultFileId)).returning();
  return { attached: true, previous: previous ?? null };
};

/** Extend the lease. `held` is false once the job is no longer this worker's. */
export const heartbeatJob = async (
  id: string,
  claimToken: string,
  leaseMs: number,
): Promise<{ held: boolean; cancelRequested: boolean }> => {
  const [row] = await quietDb
    .update(jobs)
    .set({ leaseUntil: afterMs(leaseMs) })
    .where(held(id, claimToken))
    .returning({ cancelRequestedAt: jobs.cancelRequestedAt });
  return { held: row !== undefined, cancelRequested: row?.cancelRequestedAt != null };
};

const unlessCancelRequested = (status: string): SQL =>
  sql`case when ${jobs.cancelRequestedAt} is null then ${status} else ${JobStatus.cancelled} end`;

/** finished_at for a job going back to the queue: set only when it ends cancelled instead. */
const finishedIfCancelRequested = (): SQL =>
  sql`case when ${jobs.cancelRequestedAt} is null then null else now() end`;

const finishValues = (finish: JobFinish): PgUpdateSetSource<typeof jobs> => {
  switch (finish.kind) {
    case 'succeeded':
      return { ...unclaimed, status: JobStatus.succeeded, finishedAt: sql`now()`, lastError: null };
    case 'retry':
      return {
        ...unclaimed,
        status: unlessCancelRequested(JobStatus.queued),
        finishedAt: finishedIfCancelRequested(),
        runAfter: afterMs(finish.delayMs),
        lastError: finish.error,
      };
    case 'dead':
      return {
        ...unclaimed,
        status: unlessCancelRequested(JobStatus.dead),
        finishedAt: sql`now()`,
        lastError: finish.error,
      };
    default:
      return { ...unclaimed, status: finish.kind, finishedAt: sql`now()`, lastError: finish.error };
  }
};

/**
 * Record how a claimed job ended, with the progress it last reported. False when the job was no
 * longer this worker's.
 */
export const finishJob = async (
  id: string,
  claimToken: string,
  finish: JobFinish,
  progress?: JobProgress,
): Promise<boolean> => {
  const rows = await quietDb
    .update(jobs)
    .set({
      ...finishValues(finish),
      ...(progress ? { progressDone: progress.done, progressTotal: progress.total } : {}),
    })
    .where(held(id, claimToken))
    .returning({ id: jobs.id });
  return rows.length > 0;
};

/**
 * Hand a claimed job back for another worker without counting the attempt. A job whose cancel was
 * requested ends cancelled instead.
 */
export const releaseJob = async (id: string, claimToken: string): Promise<boolean> => {
  const rows = await quietDb
    .update(jobs)
    .set({
      ...unclaimed,
      status: unlessCancelRequested(JobStatus.queued),
      finishedAt: finishedIfCancelRequested(),
      attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
      runAfter: sql`now()`,
    })
    .where(held(id, claimToken))
    .returning({ id: jobs.id });
  return rows.length > 0;
};

/**
 * Cancel a job. A queued job is cancelled now; a running job is asked to stop and ends at its next
 * heartbeat. The first request's time and asker, and whether they asked through the administration
 * routes, are kept. not_active: missing, or already finished.
 */
export const cancelJob = async (
  workspaceId: string,
  id: string,
  actor: { id: string; admin: boolean },
): Promise<'cancelled' | 'requested' | 'not_active'> => {
  const firstAsk = sql`${jobs.cancelRequestedAt} is null`;
  const [row] = await quietDb
    .update(jobs)
    .set({
      status: sql`case when ${jobs.status} = ${JobStatus.queued} then ${JobStatus.cancelled} else ${jobs.status} end`,
      finishedAt: sql`case when ${jobs.status} = ${JobStatus.queued} then now() else ${jobs.finishedAt} end`,
      cancelRequestedAt: sql`coalesce(${jobs.cancelRequestedAt}, now())`,
      cancelRequestedBy: sql`case when ${firstAsk} then ${actor.id}::uuid else ${jobs.cancelRequestedBy} end`,
      cancelRequestedByAdmin: sql`case when ${firstAsk} then ${actor.admin} else ${jobs.cancelRequestedByAdmin} end`,
    })
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.workspaceId, workspaceId),
        inArray(jobs.status, [JobStatus.queued, JobStatus.running]),
      ),
    )
    .returning({ status: jobs.status });
  if (!row) return 'not_active';
  return row.status === JobStatus.cancelled ? 'cancelled' : 'requested';
};

/**
 * Requeue running jobs whose lease expired (their worker died), or end them as cancelled or dead, then
 * delete up to `retentionBatch` finished jobs past retention. Succeeded jobs use
 * `succeededRetentionDays`; dead and cancelled jobs use `deadRetentionDays`. A job that still points
 * at a result file is kept until the result sweep has removed it.
 */
export const sweepJobs = async (retention: {
  retentionBatch: number;
  succeededRetentionDays: number;
  deadRetentionDays: number;
}): Promise<JobSweepResult> => {
  const ends = sql`${jobs.cancelRequestedAt} is not null or ${jobs.attempts} >= ${jobs.maxAttempts}`;
  const expired = await quietDb
    .update(jobs)
    .set({
      ...unclaimed,
      status: sql`case when ${jobs.cancelRequestedAt} is not null then ${JobStatus.cancelled} when ${jobs.attempts} >= ${jobs.maxAttempts} then ${JobStatus.dead} else ${JobStatus.queued} end`,
      finishedAt: sql`case when ${ends} then now() end`,
      runAfter: sql`now()`,
      lastError: LEASE_EXPIRED,
    })
    .where(and(eq(jobs.status, JobStatus.running), lt(jobs.leaseUntil, sql`now()`)))
    .returning({ status: jobs.status });
  const isPastRetention = and(
    isNull(jobs.resultFileId),
    or(
      and(
        eq(jobs.status, JobStatus.succeeded),
        lt(jobs.finishedAt, daysAgo(retention.succeededRetentionDays)),
      ),
      and(
        inArray(jobs.status, [JobStatus.dead, JobStatus.cancelled]),
        lt(jobs.finishedAt, daysAgo(retention.deadRetentionDays)),
      ),
    ),
  );
  const pastRetention = quietDb
    .select({ id: jobs.id })
    .from(jobs)
    .where(isPastRetention)
    .limit(retention.retentionBatch);
  // Checked again on each row it deletes, so a job re-run while the delete waited is kept.
  const deleted = await quietDb
    .delete(jobs)
    .where(and(inArray(jobs.id, pastRetention), isPastRetention));
  const count = (status: string) => expired.filter((row) => row.status === status).length;
  return {
    requeued: count(JobStatus.queued),
    dead: count(JobStatus.dead),
    cancelled: count(JobStatus.cancelled),
    deleted: deleted.rowCount ?? 0,
  };
};

const ENDED_UNSUCCESSFULLY = [JobStatus.dead, JobStatus.cancelled];

/**
 * Remove up to `batch` result files: those past their expiry, and those of jobs that ended dead or
 * cancelled. One transaction locks the jobs (skipping any being written), points them away from their
 * files and deletes the file rows; the caller then deletes the returned files' bytes. A dead or
 * cancelled job's expiry goes too, so it never reads as expired.
 */
export const sweepJobResults = (batch: number): Promise<FileRecord[]> =>
  quietDb.transaction(async (tx) => {
    const due = await tx
      .select({ id: jobs.id, resultFileId: jobs.resultFileId })
      .from(jobs)
      .where(
        and(
          isNotNull(jobs.resultFileId),
          or(lte(jobs.resultExpiresAt, sql`now()`), inArray(jobs.status, ENDED_UNSUCCESSFULLY)),
        ),
      )
      .limit(batch)
      .for('update', { skipLocked: true });
    const fileIds = due.flatMap((row) => (row.resultFileId ? [row.resultFileId] : []));
    if (fileIds.length === 0) return [];
    await tx
      .update(jobs)
      .set({
        resultFileId: null,
        resultExpiresAt: sql`case when ${inArray(jobs.status, ENDED_UNSUCCESSFULLY)} then null else ${jobs.resultExpiresAt} end`,
      })
      .where(
        inArray(
          jobs.id,
          due.map((row) => row.id),
        ),
      );
    return tx.delete(files).where(inArray(files.id, fileIds)).returning();
  });

export const jobStats = async (): Promise<JobStats> => {
  const [row] = await quietDb
    .select({
      oldestQueuedSeconds: sql<
        number | null
      >`floor(extract(epoch from now() - (min(${jobs.runAfter}) filter (where ${jobs.status} = ${JobStatus.queued} and ${jobs.runAfter} <= now()))))::int`,
      dead: sql<number>`(count(*) filter (where ${jobs.status} = ${JobStatus.dead}))::int`,
    })
    .from(jobs);
  return { oldestQueuedSeconds: row?.oldestQueuedSeconds ?? null, dead: row?.dead ?? 0 };
};
