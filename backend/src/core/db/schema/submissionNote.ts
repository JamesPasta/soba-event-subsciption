import { index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appUsers, sobaSchema, workspaces } from './core';
import { submissions } from './forms';

/**
 * Staff notes on a submission, append-only: never edited or deleted, and never shown to submitters.
 * The id is chosen by the client, so a retried add writes the note once.
 */
export const submissionNotes = sobaSchema.table(
  'submission_note',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    text: text('text').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    /** The author's label when the note was added, as the audit columns keep it. */
    createdByLabel: text('created_by_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    submissionIdx: index('submission_note_submission_idx').on(
      table.submissionId,
      table.createdAt.desc(),
    ),
    workspaceIdx: index('submission_note_workspace_idx').on(table.workspaceId),
  }),
);
