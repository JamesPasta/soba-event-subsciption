import {
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  integer,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, idColumn, softDeleteColumns } from './audit';
import { appUsers, sobaSchema, workspaces } from './core';

/** Constraint names a unique violation is matched on; the primary keys keep Postgres's default names. */
export const FORM_PKEY = 'form_pkey';
export const FORM_VERSION_PKEY = 'form_version_pkey';
export const FORM_WORKSPACE_NAME_UNIQUE = 'form_workspace_name_uq';

export const forms = sobaSchema.table(
  'form',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formEngineCode: text('form_engine_code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    org: text('org').notNull(),
    useCase: text('use_case').notNull(),
    status: text('status').notNull(),
    ...auditColumns(),
    ...softDeleteColumns(),
  },
  (table) => ({
    // Non-deleted forms only, so a soft-deleted form frees its name for reuse.
    workspaceNameUnique: uniqueIndex(FORM_WORKSPACE_NAME_UNIQUE)
      .on(table.workspaceId, table.name)
      .where(sql`${table.deletedAt} is null`),
    workspaceIdUnique: uniqueIndex('form_workspace_id_uq').on(table.workspaceId, table.id),
    workspaceIdx: index('form_workspace_idx').on(table.workspaceId),
  }),
);

export const FORM_VERSION_ONE_PUBLISHED_UNIQUE = 'form_version_one_published_uq';

export const formVersions = sobaSchema.table(
  'form_version',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id),
    versionNo: integer('version_no').notNull(),
    state: text('state').notNull(),
    engineSchemaRef: text('engine_schema_ref'),
    engineSyncStatus: text('engine_sync_status').notNull(),
    engineSyncError: text('engine_sync_error'),
    currentRevisionNo: integer('current_revision_no').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => appUsers.id),
    ...auditColumns(),
    ...softDeleteColumns(),
  },
  (table) => ({
    uniqueVersion: uniqueIndex('form_version_workspace_form_version_uq').on(
      table.workspaceId,
      table.formId,
      table.versionNo,
    ),
    workspaceIdx: index('form_version_workspace_idx').on(table.workspaceId),
    formIdx: index('form_version_form_idx').on(table.formId),
    // Publishing archives the previous version first, so a form has at most one published version.
    onePublished: uniqueIndex(FORM_VERSION_ONE_PUBLISHED_UNIQUE)
      .on(table.formId)
      .where(sql`${table.state} = 'published' and ${table.deletedAt} is null`),
  }),
);

export const formVersionRevisions = sobaSchema.table(
  'form_version_revision',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formVersionId: uuid('form_version_id')
      .notNull()
      .references(() => formVersions.id),
    revisionNo: integer('revision_no').notNull(),
    eventType: text('event_type').notNull(),
    beforeEngineSchemaRef: text('before_engine_schema_ref'),
    afterEngineSchemaRef: text('after_engine_schema_ref'),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => appUsers.id),
    changeNote: text('change_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueRevision: uniqueIndex('form_version_revision_workspace_form_version_revision_uq').on(
      table.workspaceId,
      table.formVersionId,
      table.revisionNo,
    ),
    workspaceIdx: index('form_version_revision_workspace_idx').on(table.workspaceId),
  }),
);

export const SUBMISSION_CONFIRMATION_CODE_UNIQUE = 'submission_confirmation_code_uq';

export const SUBMISSION_REVISION_PKEY = 'submission_revision_pkey';

export const submissions = sobaSchema.table(
  'submission',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id),
    formVersionId: uuid('form_version_id')
      .notNull()
      .references(() => formVersions.id),
    submittedBy: uuid('submitted_by').references(() => appUsers.id),
    workflowState: text('workflow_state').notNull(),
    engineSubmissionRef: text('engine_submission_ref'),
    engineSyncStatus: text('engine_sync_status').notNull(),
    engineSyncError: text('engine_sync_error'),
    currentRevisionNo: integer('current_revision_no').notNull().default(0),
    headRevisionId: uuid('head_revision_id').references((): AnyPgColumn => submissionRevisions.id),
    /** The latest review status (submission_status); null until the submission is first submitted. */
    statusId: uuid('status_id').references((): AnyPgColumn => submissionStatuses.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // 8 characters of Crockford base32, assigned at open; returned only once submitted.
    confirmationCode: text('confirmation_code').notNull(),
    ...auditColumns(),
    ...softDeleteColumns(),
  },
  (table) => ({
    confirmationCodeUnique: uniqueIndex(SUBMISSION_CONFIRMATION_CODE_UNIQUE).on(
      table.confirmationCode,
    ),
    workspaceWorkflowIdx: index('submission_workspace_workflow_idx').on(
      table.workspaceId,
      table.workflowState,
    ),
    workspaceIdx: index('submission_workspace_idx').on(table.workspaceId),
    formVersionIdx: index('submission_form_version_idx').on(table.formVersionId),
    // Workspace slice ordered by server updatedAt (id as tiebreak), excluding soft-deleted rows.
    // Matches the submission list default sort. A multi-workspace scope or a deep offset does not
    // use it.
    workspaceUpdatedIdx: index('submission_workspace_updated_idx')
      .on(table.workspaceId, table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} is null`),
    headRevisionIdx: index('submission_head_revision_idx').on(table.headRevisionId),
    statusIdx: index('submission_status_id_idx').on(table.statusId),
    // A form's live submissions in submission order, the order an export reads them in.
    formSubmittedIdx: index('submission_form_submitted_idx')
      .on(table.formId, table.submittedAt, table.id)
      .where(sql`${table.deletedAt} is null`),
  }),
);

export const submissionRevisions = sobaSchema.table(
  'submission_revision',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    revisionNo: integer('revision_no').notNull(),
    parentRevisionId: uuid('parent_revision_id').references(
      (): AnyPgColumn => submissionRevisions.id,
    ),
    eventType: text('event_type').notNull(),
    status: text('status').notNull(),
    reason: text('reason').notNull(),
    beforeEngineSubmissionRef: text('before_engine_submission_ref'),
    afterEngineSubmissionRef: text('after_engine_submission_ref'),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => appUsers.id),
    changeNote: text('change_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueRevision: uniqueIndex('submission_revision_workspace_submission_revision_uq').on(
      table.workspaceId,
      table.submissionId,
      table.revisionNo,
    ),
    workspaceIdx: index('submission_revision_workspace_idx').on(table.workspaceId),
    parentRevisionIdx: index('submission_revision_parent_idx').on(table.parentRevisionId),
  }),
);

/**
 * A submission's review status changes, append-only. `submission.status_id` points at the latest;
 * the rows before it are the history. The status codes are the lib's SUBMISSION_REVIEW_STATUSES.
 */
export const submissionStatuses = sobaSchema.table(
  'submission_status',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    status: text('status').notNull(),
    assigneeId: uuid('assignee_id').references(() => appUsers.id),
    changedBy: uuid('changed_by').references(() => appUsers.id),
    /** The changer's label when the change was made, as the audit columns keep it. */
    changedByLabel: text('changed_by_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    submissionIdx: index('submission_status_submission_idx').on(
      table.submissionId,
      table.createdAt.desc(),
    ),
    workspaceIdx: index('submission_status_workspace_idx').on(table.workspaceId),
    assigneeIdx: index('submission_status_assignee_idx').on(table.assigneeId),
  }),
);
