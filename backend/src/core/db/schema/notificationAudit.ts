import { index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { NotificationOutcomeCode } from '../codes';
import { idColumn } from './audit';
import { sobaSchema, appUsers, workspaces } from './core';
import { forms, submissions } from './forms';

/** Who a message was addressed to, as sent to the provider. */
export interface NotificationAuditRecipients {
  to: string[];
  cc?: string[];
  bcc?: string[];
}

/**
 * Append-only log of notification sends: one row per send through the notification service,
 * including sends skipped because the feature is off. Records the recipients and the provider's
 * error text; read by SOBA admins only. A failed write never fails the send; rows are never updated
 * or deleted.
 */
export const notificationAudits = sobaSchema.table(
  'notification_audit',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id').references(() => forms.id),
    submissionId: uuid('submission_id').references(() => submissions.id),
    pluginCode: text('plugin_code').notNull(),
    channel: text('channel').notNull(),
    outcome: text('outcome').$type<NotificationOutcomeCode>().notNull(),
    recipients: jsonb('recipients').$type<NotificationAuditRecipients>().notNull(),
    subject: text('subject'),
    providerMessageId: text('provider_message_id'),
    providerStatus: text('provider_status'),
    // The provider's HTTP status on error; null on success or when no response came back.
    httpStatus: integer('http_status'),
    // Error class, upstream status and the provider's error text, bounded.
    errorDetail: text('error_detail'),
    durationMs: integer('duration_ms').notNull(),
    // Correlation id (X-Request-Id) to pivot an audit row back to the request's app logs.
    requestId: text('request_id'),
    // The job that sent it, if any. No foreign key, so job retention never waits on the audit.
    jobId: uuid('job_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceCreatedIdx: index('notification_audit_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    formCreatedIdx: index('notification_audit_form_created_idx').on(table.formId, table.createdAt),
    submissionIdx: index('notification_audit_submission_idx').on(table.submissionId),
    jobIdx: index('notification_audit_job_idx').on(table.jobId),
    createdIdx: index('notification_audit_created_idx').on(table.createdAt),
  }),
);
