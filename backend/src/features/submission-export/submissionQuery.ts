import {
  countExportSubmissions,
  readExportSubmissionPage,
  type ExportSubmissionCursor,
  type ExportSubmissionRow,
} from '../../core/db/repos/submissionExportRepo';
import type { SubmissionQuery, SubmissionRecord } from './engineSource';
import type { ExportBounds } from './source';

const toRecord = (row: ExportSubmissionRow): SubmissionRecord => ({
  submissionId: row.submissionId,
  confirmationCode: row.confirmationCode,
  versionId: row.versionId,
  submittedAt: row.submittedAt.toISOString(),
  submitter: row.submitter,
  username: row.username,
  email: row.email,
  engineSchemaRef: row.engineSchemaRef,
  engineSubmissionRef: row.engineSubmissionRef,
});

/**
 * The bounds' submissions a page at a time, each page read when the one before has been taken and
 * started after its last row; a short page is the last.
 */
const pagesOf = (
  bounds: ExportBounds,
  pageSize: number,
  signal: AbortSignal,
): AsyncIterable<SubmissionRecord[]> => ({
  [Symbol.asyncIterator]: () => {
    let after: ExportSubmissionCursor | null = null;
    let finished = false;
    return {
      next: async (): Promise<IteratorResult<SubmissionRecord[], undefined>> => {
        if (finished) return { done: true, value: undefined };
        signal.throwIfAborted();
        const rows = await readExportSubmissionPage(bounds, after, pageSize);
        const last = rows.at(-1);
        finished = !last || rows.length < pageSize;
        if (!last) return { done: true, value: undefined };
        after = { submittedAt: last.submittedAtText, submissionId: last.submissionId };
        return { done: false, value: rows.map(toRecord) };
      },
    };
  },
});

/** The form's submissions an export covers, read from Postgres a page at a time. */
export const submissionExportQuery: SubmissionQuery = {
  count: (bounds) => countExportSubmissions(bounds),
  pages: (bounds, { pageSize, signal }) => pagesOf(bounds, pageSize, signal),
};
