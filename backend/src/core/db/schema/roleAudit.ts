import { sql } from 'drizzle-orm';
import { check, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './audit';
import { sobaSchema, workspaces } from './core';
import { roles } from './roles';

/**
 * One row per write to a workspace's own role, written in the write's transaction and never changed.
 * `before` and `after` hold the role's name and permission codes: a create has no `before`, a delete
 * no `after`. The actor has no foreign key, so history outlives a removed user.
 */
export const roleAudit = sobaSchema.table(
  'role_audit',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    roleCode: text('role_code')
      .notNull()
      .references(() => roles.code),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    actorId: uuid('actor_id').notNull(),
    actorDisplayLabel: text('actor_display_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actionCheck: check(
      'role_audit_action_check',
      sql`${table.action} in ('create', 'update', 'delete')`,
    ),
    workspaceIdx: index('role_audit_workspace_idx').on(table.workspaceId, table.createdAt),
    roleIdx: index('role_audit_role_idx').on(table.roleCode, table.createdAt),
  }),
);
