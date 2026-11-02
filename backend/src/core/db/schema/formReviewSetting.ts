import { boolean, index, integer, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, idColumn } from './audit';
import { sobaSchema, workspaces } from './core';
import { forms } from './forms';

/**
 * How a workspace's submissions are reviewed, served by the form-settings `review` module. One row
 * per workspace, created with it; each flag is a typed column whose database default is the
 * setting's default.
 */
export const workspaceReviewSettings = sobaSchema.table(
  'workspace_review_setting',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    allowStatusUpdates: boolean('allow_status_updates').notNull().default(false),
    allowSubmitterRevision: boolean('allow_submitter_revision').notNull().default(false),
    /** Moves on with every save; a save names the version it started from. */
    version: integer('version').notNull().default(1),
    ...auditColumns(),
  },
  (table) => ({
    workspaceUnique: uniqueIndex('workspace_review_setting_workspace_uq').on(table.workspaceId),
  }),
);

/**
 * A form's review settings. One row per form, created with it. While `inherit` is true the form
 * uses the workspace's settings and its own flags are null; otherwise they hold the form's settings.
 */
export const formReviewSettings = sobaSchema.table(
  'form_review_setting',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id),
    inherit: boolean('inherit').notNull().default(true),
    allowStatusUpdates: boolean('allow_status_updates'),
    allowSubmitterRevision: boolean('allow_submitter_revision'),
    /** Moves on with every save; a save names the version it started from. */
    version: integer('version').notNull().default(1),
    ...auditColumns(),
  },
  (table) => ({
    formUnique: uniqueIndex('form_review_setting_form_uq').on(table.formId),
    workspaceIdx: index('form_review_setting_workspace_idx').on(table.workspaceId),
  }),
);
