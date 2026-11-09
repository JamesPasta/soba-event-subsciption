import { index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './audit';
import { appUsers, sobaSchema, workspaces } from './core';
import { forms } from './forms';

/**
 * Append-only log of submission exports: one row when an export is started, one when its file is
 * stored, and one each time the file is downloaded. Never holds submission data.
 */
export const submissionExportAudits = sobaSchema.table(
  'submission_export_audit',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id),
    // No foreign keys: jobs and their result files are deleted under retention.
    jobId: uuid('job_id').notNull(),
    fileId: uuid('file_id'),
    // started, finished or downloaded.
    action: text('action').notNull(),
    format: text('format').notNull(),
    // Finished and downloaded: the rows written, the submissions left out because they could not
    // be read, and the file's size.
    rowCount: integer('row_count'),
    unreadCount: integer('unread_count'),
    size: integer('size'),
    // Correlation id (X-Request-Id) to pivot an audit row back to the request's app logs.
    requestId: text('request_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    formCreatedIdx: index('submission_export_audit_form_created_idx').on(
      table.formId,
      table.createdAt,
    ),
    workspaceIdx: index('submission_export_audit_workspace_idx').on(table.workspaceId),
    jobIdx: index('submission_export_audit_job_idx').on(table.jobId),
  }),
);
