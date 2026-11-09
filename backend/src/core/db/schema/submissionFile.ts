import { index, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, idColumn } from './audit';
import { sobaSchema, workspaces } from './core';
import { files } from './file';
import { submissions } from './forms';

/** A file attached to a submission. A file has at most one link. */
export const submissionFiles = sobaSchema.table(
  'submission_file',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    ...auditColumns(),
  },
  (table) => ({
    fileUnique: uniqueIndex('submission_file_file_uq').on(table.fileId),
    submissionIdx: index('submission_file_submission_idx').on(table.submissionId),
    workspaceIdx: index('submission_file_workspace_idx').on(table.workspaceId),
  }),
);
