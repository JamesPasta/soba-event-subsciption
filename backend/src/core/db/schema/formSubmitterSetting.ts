import { boolean, index, integer, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, idColumn } from './audit';
import { sobaSchema, workspaces } from './core';
import { forms } from './forms';

/**
 * What a workspace's submitters may do, served by the form-settings `submitter` module. One row per
 * workspace, created with it; each flag is a typed column whose database default is the setting's
 * default.
 */
export const workspaceSubmitterSettings = sobaSchema.table(
  'workspace_submitter_setting',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    allowSubmitterDrafts: boolean('allow_submitter_drafts').notNull().default(false),
    /** Moves on with every save; a save names the version it started from. */
    version: integer('version').notNull().default(1),
    ...auditColumns(),
  },
  (table) => ({
    workspaceUnique: uniqueIndex('workspace_submitter_setting_workspace_uq').on(table.workspaceId),
  }),
);

/**
 * A form's submitter settings. One row per form, created with it. While `inherit` is true the form
 * uses the workspace's settings and its own flags are null; otherwise they hold the form's settings.
 */
export const formSubmitterSettings = sobaSchema.table(
  'form_submitter_setting',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id),
    inherit: boolean('inherit').notNull().default(true),
    allowSubmitterDrafts: boolean('allow_submitter_drafts'),
    /** Moves on with every save; a save names the version it started from. */
    version: integer('version').notNull().default(1),
    ...auditColumns(),
  },
  (table) => ({
    formUnique: uniqueIndex('form_submitter_setting_form_uq').on(table.formId),
    workspaceIdx: index('form_submitter_setting_workspace_idx').on(table.workspaceId),
  }),
);
