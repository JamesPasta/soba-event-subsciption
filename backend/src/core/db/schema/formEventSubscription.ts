import { index, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, idColumn } from './audit';
import { sobaSchema, workspaces } from './core';
import { forms } from './forms';

export const formEventSubscriptions = sobaSchema.table(
  'form_event_subscription',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id),
    endpointUrl: text('endpoint_url').notNull().default(''),
    key: text('key').notNull().default(''),
    encryptedToken: text('encrypted_token'),
    version: integer('version').notNull().default(1),
    ...auditColumns(),
  },
  (table) => ({
    formUnique: uniqueIndex('form_event_subscription_form_uq').on(table.formId),
    workspaceIdx: index('form_event_subscription_workspace_idx').on(table.workspaceId),
  }),
);
