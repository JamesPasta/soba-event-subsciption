import { index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, idColumn } from './audit';
import { appUsers, sobaSchema, workspaces } from './core';
import { submissions } from './forms';

/**
 * Who may act on a submission through submit mode after it is opened. A grant is never deleted:
 * revoking one sets status inactive with revoked_by/revoked_at, so the rows are the access history.
 * created_at is when the grant was made.
 */
export const submissionParticipants = sobaSchema.table(
  'submission_participant',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id),
    role: text('role').notNull(),
    status: text('status').notNull(),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => appUsers.id),
    revokedBy: uuid('revoked_by').references(() => appUsers.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => ({
    submissionUserUnique: uniqueIndex('submission_participant_submission_user_uq')
      .on(table.submissionId, table.userId)
      .where(sql`${table.status} = 'active'`),
    userActiveIdx: index('submission_participant_user_active_idx')
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    submissionIdx: index('submission_participant_submission_idx').on(table.submissionId),
    workspaceIdx: index('submission_participant_workspace_idx').on(table.workspaceId),
  }),
);
