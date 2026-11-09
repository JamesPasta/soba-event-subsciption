import { index, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, idColumn } from './audit';
import { sobaSchema, workspaces } from './core';
import { files } from './file';
import { formVersions, forms } from './forms';

export const DOCUMENT_TEMPLATE_VERSION_TYPE_UNIQUE = 'document_template_version_type_uq';

/**
 * A document template on one form version: a stored file of a type, at most one of each type per
 * version. The id stays the same when the file is replaced. Templates carried to a new version
 * share the file until one of them replaces it.
 */
export const documentTemplates = sobaSchema.table(
  'document_template',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id),
    formVersionId: uuid('form_version_id')
      .notNull()
      .references(() => formVersions.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    type: text('type').notNull().default('cdogs'),
    name: text('name').notNull(),
    ...auditColumns(),
  },
  (table) => ({
    fileIdx: index('document_template_file_idx').on(table.fileId),
    versionTypeUnique: uniqueIndex(DOCUMENT_TEMPLATE_VERSION_TYPE_UNIQUE).on(
      table.formVersionId,
      table.type,
    ),
    workspaceIdx: index('document_template_workspace_idx').on(table.workspaceId),
  }),
);
