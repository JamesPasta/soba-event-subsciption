import type { Logger } from 'pino';
import { validate as isUuid } from 'uuid';
import { designerSubmissionFileUrl } from '../../core/appLinks';
import { isRecord } from './formats';
import type { ExportRow } from './source';

/** Each uploaded file's `url` from `fileLink`; a file it gives no link for keeps its stored `url`. */
export const withStaffFileLinks = (
  value: unknown,
  fileLink: (fileId: string) => string | null,
): unknown => {
  if (Array.isArray(value)) return value.map((item) => withStaffFileLinks(item, fileLink));
  if (!isRecord(value)) return value;
  const walked = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, withStaffFileLinks(child, fileLink)]),
  );
  // An upload's `id` is always a UUID; answers named `storage` and `id` rarely are.
  if (value.storage !== 'chefs' || typeof value.id !== 'string' || !isUuid(value.id)) return walked;
  const url = fileLink(value.id);
  return url ? { ...walked, url } : walked;
};

/** Each row with its files linked to the staff download page under `base`. */
export async function* staffFileLinked(
  rows: AsyncIterable<ExportRow>,
  formId: string,
  base: string,
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

/** The rows with staff file links under `designerUrl`; without one, the rows as stored and a warning. */
export const staffLinkedRows = (
  rows: AsyncIterable<ExportRow>,
  formId: string,
  designerUrl: string | undefined,
  log: Pick<Logger, 'warn'>,
): AsyncIterable<ExportRow> => {
  if (designerUrl) return staffFileLinked(rows, formId, designerUrl);
  log.warn('DESIGNER_APP_URL unset; export keeps stored file links');
  return rows;
};
