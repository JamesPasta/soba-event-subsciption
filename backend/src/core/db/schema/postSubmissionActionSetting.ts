import { boolean, index, integer, jsonb, text, unique, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, idColumn } from './audit';
import { sobaSchema, workspaces } from './core';
import { forms } from './forms';

/**
 * One post-submission action's settings at one scope: a workspace's default (no form) or a form's
 * own. Rows are created by their first save; a missing row reads as off for a workspace and as
 * inherit for a form. `options` hold what the action's plugin schema accepts.
 */
export const postSubmissionActionSettings = sobaSchema.table(
  'post_submission_action_setting',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id').references(() => forms.id),
    actionCode: text('action_code').notNull(),
    /** A form row's choice; a workspace row is the source and ignores it. */
    inherit: boolean('inherit').notNull().default(true),
    enabled: boolean('enabled').notNull().default(false),
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    /** Moves on with every save; 0 until the first save, which names it. */
    version: integer('version').notNull().default(0),
    ...auditColumns(),
  },
  (table) => ({
    scopeUnique: unique('post_submission_action_setting_scope_uq')
      .on(table.workspaceId, table.formId, table.actionCode)
      .nullsNotDistinct(),
    formIdx: index('post_submission_action_setting_form_idx').on(table.formId),
  }),
);
