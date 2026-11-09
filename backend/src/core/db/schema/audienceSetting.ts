import { boolean, index, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, idColumn } from './audit';
import { sobaSchema, workspaces } from './core';
import { forms } from './forms';

/**
 * A workspace's Form Audience: who outside the workspace may submit to its forms. One row per
 * workspace, created with it. `idps` lists login provider codes and is empty unless `protected`.
 */
export const workspaceAudienceSettings = sobaSchema.table(
  'workspace_audience_setting',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    mode: text('mode').notNull(),
    idps: text('idps')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Moves on with every save; a save names the version it started from. */
    version: integer('version').notNull().default(1),
    ...auditColumns(),
  },
  (table) => ({
    workspaceUnique: uniqueIndex('workspace_audience_setting_workspace_uq').on(table.workspaceId),
  }),
);

/**
 * A form's Form Audience. One row per form, created with it. While `inherit` is true the form uses
 * the workspace's audience and its own columns are null; otherwise they hold the form's audience.
 */
export const formAudienceSettings = sobaSchema.table(
  'form_audience_setting',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id),
    inherit: boolean('inherit').notNull().default(true),
    mode: text('mode'),
    idps: text('idps').array(),
    /** Moves on with every save; a save names the version it started from. */
    version: integer('version').notNull().default(1),
    ...auditColumns(),
  },
  (table) => ({
    formUnique: uniqueIndex('form_audience_setting_form_uq').on(table.formId),
    workspaceIdx: index('form_audience_setting_workspace_idx').on(table.workspaceId),
  }),
);
