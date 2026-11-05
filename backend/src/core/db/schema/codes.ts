import { boolean, integer, primaryKey, text } from 'drizzle-orm/pg-core';
import { sobaSchema } from './core';

export const CODE_SOURCE_CORE = 'core';
export const CODE_SOURCE_WORKSPACE = 'workspace';

const codeColumns = () => ({
  code: text('code').notNull(),
  source: text('source').notNull().default(CODE_SOURCE_CORE),
  display: text('display').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

export const formStatus = sobaSchema.table('form_status', codeColumns(), (table) => [
  primaryKey({ columns: [table.code, table.source] }),
]);
export const formVersionState = sobaSchema.table('form_version_state', codeColumns(), (table) => [
  primaryKey({ columns: [table.code, table.source] }),
]);
export const workspaceMembershipRole = sobaSchema.table(
  'workspace_membership_role',
  codeColumns(),
  (table) => [primaryKey({ columns: [table.code, table.source] })],
);
export const workspaceMembershipStatus = sobaSchema.table(
  'workspace_membership_status',
  codeColumns(),
  (table) => [primaryKey({ columns: [table.code, table.source] })],
);
