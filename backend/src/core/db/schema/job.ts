import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn } from './audit';
import { appUsers, sobaSchema, workspaces } from './core';
import { files } from './file';
import { forms, submissionRevisions, submissions } from './forms';

/**
 * Background jobs: the queue and each job's status. Workers claim queued rows with FOR UPDATE SKIP
 * LOCKED; every write after the claim must match claim_token. Finished rows are deleted under
 * retention.
 */
export const jobs = sobaSchema.table(
  'job',
  {
    id: idColumn(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id').references(() => forms.id),
    submissionId: uuid('submission_id').references(() => submissions.id),
    revisionId: uuid('revision_id').references(() => submissionRevisions.id),
    // Set null on delete: a child can outlive its parent under retention.
    parentJobId: uuid('parent_job_id').references((): AnyPgColumn => jobs.id, {
      onDelete: 'set null',
    }),
    actionConfigId: uuid('action_config_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    // Ids and options only, never answer data.
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    paramsVersion: integer('params_version').notNull().default(1),
    // Unique while the row exists; deleting it under retention frees the key.
    dedupeKey: text('dedupe_key'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    claimToken: uuid('claim_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    // Who asked first, and whether through the administration routes.
    cancelRequestedBy: uuid('cancel_requested_by').references(() => appUsers.id),
    cancelRequestedByAdmin: boolean('cancel_requested_by_admin').notNull().default(false),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // Re-runs of a dead or cancelled job by a person, which run the same row again.
    requeueCount: integer('requeue_count').notNull().default(0),
    lastRequeuedAt: timestamp('last_requeued_at', { withTimezone: true }),
    lastRequeuedBy: uuid('last_requeued_by').references(() => appUsers.id),
    lastRequeuedByAdmin: boolean('last_requeued_by_admin').notNull().default(false),
    // Set in the transaction that queued this job's children; kept after they are deleted.
    childrenQueuedAt: timestamp('children_queued_at', { withTimezone: true }),
    // What the running attempt last reported; cleared at each claim.
    progressDone: integer('progress_done'),
    progressTotal: integer('progress_total'),
    // The file the job produced, until it expires or the job ends without succeeding. The expiry is
    // kept once the file is gone, so a succeeded job reads as expired.
    resultFileId: uuid('result_file_id').references(() => files.id),
    resultExpiresAt: timestamp('result_expires_at', { withTimezone: true }),
  },
  (table) => ({
    dedupeKeyUq: uniqueIndex('job_dedupe_key_uq').on(table.dedupeKey),
    claimIdx: index('job_claim_idx')
      .on(table.type, table.runAfter)
      .where(sql`${table.status} = 'queued'`),
    leaseIdx: index('job_lease_idx')
      .on(table.leaseUntil)
      .where(sql`${table.status} = 'running'`),
    parentIdx: index('job_parent_idx')
      .on(table.parentJobId)
      .where(sql`${table.parentJobId} is not null`),
    finishedIdx: index('job_finished_idx')
      .on(table.finishedAt)
      .where(sql`${table.finishedAt} is not null`),
    workspaceIdx: index('job_workspace_idx').on(table.workspaceId),
    formIdx: index('job_form_idx').on(table.formId),
    submissionIdx: index('job_submission_idx').on(table.submissionId),
    revisionIdx: index('job_revision_idx').on(table.revisionId),
    createdIdx: index('job_created_idx').on(table.createdAt.desc(), table.id.desc()),
    // Serves the result sweep and the foreign key check when any file row is deleted.
    resultFileIdx: index('job_result_file_idx')
      .on(table.resultFileId)
      .where(sql`${table.resultFileId} is not null`),
    // Serves the per-form count of exports still to finish, taken at every start.
    activeExportIdx: index('job_active_export_idx')
      .on(table.formId)
      .where(sql`${table.type} = 'submission-export' and ${table.status} in ('queued', 'running')`),
  }),
);
