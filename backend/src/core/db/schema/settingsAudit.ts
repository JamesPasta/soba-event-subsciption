import { index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './audit';
import { sobaSchema, workspaces } from './core';
import { forms } from './forms';

/**
 * One row per save of a settings group, written in the save's transaction and never changed. A
 * workspace-level save has no form. `before` and `after` hold the fields the save wrote, and
 * `version` is the row's version after it. The actor has no foreign key, so history outlives a
 * removed user.
 */
export const settingsAudit = sobaSchema.table(
  'settings_audit',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id').references(() => forms.id),
    groupKey: text('group_key').notNull(),
    version: integer('version').notNull(),
    before: jsonb('before').notNull(),
    after: jsonb('after').notNull(),
    actorId: uuid('actor_id'),
    actorDisplayLabel: text('actor_display_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('settings_audit_workspace_idx').on(table.workspaceId, table.createdAt),
    formIdx: index('settings_audit_form_idx').on(table.formId, table.createdAt),
  }),
);
