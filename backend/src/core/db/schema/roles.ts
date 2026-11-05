import { sql } from 'drizzle-orm';
import { boolean, check, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit';
import { sobaSchema } from './sobaSchema';
import { features } from './feature';
import { CODE_SOURCE_CORE } from './codes';
import { workspaces } from './core';

/**
 * Role status code table. Used by soba.roles.status.
 */
export const roleStatus = sobaSchema.table('role_status', {
  code: text('code').primaryKey(),
  display: text('display').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

/**
 * DB-backed roles. source = 'core', 'feature' or 'workspace'; feature_code set when source is
 * 'feature', workspace_id set when source is 'workspace'. Extensible: features can add roles with
 * source = 'feature' and feature_code = their code.
 */
export const roles = sobaSchema.table(
  'role',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    source: text('source').notNull().default(CODE_SOURCE_CORE),
    featureCode: text('feature_code').references(() => features.code),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    ...auditColumns(),
  },
  (table) => ({
    workspaceSourceCheck: check(
      'role_workspace_source_check',
      sql`(${table.source} = 'workspace') = (${table.workspaceId} is not null)`,
    ),
    // Active roles only, so a soft-deleted role frees its name for reuse.
    workspaceNameUnique: uniqueIndex('role_workspace_name_uq')
      .on(table.workspaceId, table.name)
      .where(sql`${table.status} = 'active'`),
  }),
);
