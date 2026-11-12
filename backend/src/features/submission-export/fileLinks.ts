import { designerSubmissionFileUrl } from '../../core/integrations/notification/email/url';
import { isRecord } from './formats';
import type { ExportRow } from './source';

/** Each uploaded file's `url` from `fileLink`; a file it gives no link for keeps its stored `url`. */
export const withStaffFileLinks = (
  value: unknown,
  fileLink: (fileId: string) => string | null,
): unknown => {
  if (Array.isArray(value)) return value.map((item) => withStaffFileLinks(item, fileLink));
  if (!isRecord(value)) return value;
  if (value.storage === 'chefs' && typeof value.id === 'string') {
    const url = fileLink(value.id);
    return url ? { ...value, url } : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, withStaffFileLinks(child, fileLink)]),
  );
};

/** Each row with its files linked to the staff download page; without a base, as stored. */
export async function* staffFileLinked(
  rows: AsyncIterable<ExportRow>,
  formId: string,
  base: string | undefined,
): AsyncIterable<ExportRow> {
  for await (const row of rows) {
    yield {
      ...row,
      answers: withStaffFileLinks(row.answers, (fileId) =>
        designerSubmissionFileUrl(base, 'en', formId, row.submissionId, fileId),
      ) as ExportRow['answers'],
    };
  }
}
