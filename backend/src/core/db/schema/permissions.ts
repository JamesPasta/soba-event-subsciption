import { sql } from 'drizzle-orm';
import { check, primaryKey, text } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit';
import { sobaSchema } from './sobaSchema';
import { features } from './feature';
import { roles } from './roles';
import { CODE_SOURCE_CORE } from './codes';

/**
 * DB-backed permissions. `source` is 'core' or a feature code. The `*` code is a wildcard: a role
 * holding it satisfies any permission check.
 */
export const permissions = sobaSchema.table('permission', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  source: text('source').notNull().default(CODE_SOURCE_CORE),
  featureCode: text('feature_code').references(() => features.code),
  ...auditColumns(),
});

/** Maps roles to permissions. Only `form_admin` can map to the `*` wildcard. */
export const rolePermissions = sobaSchema.table(
  'role_permission',
  {
    roleCode: text('role_code')
      .notNull()
      .references(() => roles.code),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code),
  },
  (table) => [
    primaryKey({ columns: [table.roleCode, table.permissionCode] }),
    check(
      'role_permission_wildcard_check',
      sql`${table.permissionCode} <> '*' or ${table.roleCode} = 'form_admin'`,
    ),
  ],
);
