import type { ExportRow } from './source';

/** The submission's own facts, under the `form.` names CHEFS exports use. */
export const SUBMISSION_FIELDS: Record<string, (row: ExportRow) => string> = {
  'form.confirmationId': (row) => row.confirmationCode,
  'form.submissionId': (row) => row.submissionId,
  'form.formVersionId': (row) => row.versionId,
  'form.submittedAt': (row) => row.submittedAt,
  'form.submitter': (row) => row.submitter,
  'form.username': (row) => row.username,
  'form.email': (row) => row.email,
};
