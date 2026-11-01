import { getFormEngineCodeForForm } from '../../core/db/repos/formRepo';
import { exportSchemaRefs } from '../../core/db/repos/submissionExportRepo';
import { mapInOrder } from '../../core/inOrder';
import type {
  FormEngineAdapter,
  ReadSubmissionsOptions,
  ReadSubmissionsResult,
} from '../../core/integrations/form-engine/FormEngineAdapter';
import { createFormEngineAdapter } from '../../core/integrations/form-engine/FormEngineRegistry';
import { JobFailedError } from '../../core/jobs/settlement';
import { readEngineSchema } from '../../core/services/engineSchema';
import type { ExportBounds, ExportRow, ExportRowsOptions, ExportSource } from './source';

/** One submission as the submissions query returns it, before its answers are read. */
export interface SubmissionRecord {
  submissionId: string;
  confirmationCode: string;
  versionId: string;
  submittedAt: string;
  /** Who submitted it, or `public`. */
  submitter: string;
  /** The submitter's username and email; blank for an anonymous submission. */
  username: string;
  email: string;
  /** The version's form in the engine; null when the version never reached it. */
  engineSchemaRef: string | null;
  /** The submission's document in the engine; null when it never reached it. */
  engineSubmissionRef: string | null;
}

/** The submissions an export covers, without their answers. */
export interface SubmissionQuery {
  /** How many submissions the bounds cover. */
  count(bounds: ExportBounds): Promise<number>;
  /** The submissions in the bounds, oldest first, `pageSize` at a time. */
  pages(
    bounds: ExportBounds,
    options: { pageSize: number; signal: AbortSignal },
  ): AsyncIterable<SubmissionRecord[]>;
}

/** Reads the documents of many submissions of one engine form. */
export type ReadAnswers = (
  engineFormRef: string,
  engineRefs: string[],
  signal: AbortSignal,
) => Promise<ReadSubmissionsResult>;

/**
 * The engine's bulk read with the given options; an engine without one cannot export. Without
 * `full`, signature images and base64 file data stay out of an export.
 */
export const bulkAnswerReader = (
  adapter: FormEngineAdapter,
  options: ReadSubmissionsOptions = {},
): ReadAnswers => {
  if (typeof adapter.readSubmissions !== 'function') {
    throw new JobFailedError('The form engine cannot read submissions in bulk');
  }
  const read = adapter.readSubmissions.bind(adapter);
  return (engineFormRef, engineRefs, signal) => read(engineFormRef, engineRefs, signal, options);
};

/** The bulk read of the form's engine. */
export const formAnswerReader = async (
  workspaceId: string,
  formId: string,
  options: ReadSubmissionsOptions = {},
): Promise<ReadAnswers> => {
  const engineCode = await getFormEngineCodeForForm(workspaceId, formId);
  if (!engineCode) throw new JobFailedError('The form has no form engine');
  return bulkAnswerReader(createFormEngineAdapter(engineCode), options);
};

/**
 * The schemas of the form's versions an export covers, newest version first, read one at a time.
 * A form without an engine, or a version the engine has no schema for, adds none.
 */
export const exportSchemas = async (
  workspaceId: string,
  formId: string,
  formVersionId?: string,
): Promise<Record<string, unknown>[]> => {
  const engineCode = await getFormEngineCodeForForm(workspaceId, formId);
  if (!engineCode) return [];
  const refs = await exportSchemaRefs(workspaceId, formId, formVersionId);
  const schemas = await mapInOrder(refs, (ref) => readEngineSchema(engineCode, ref));
  return schemas.filter((schema) => schema !== null);
};

/** The answers in an engine document, which keeps them under `data`. */
const answersIn = (doc: Record<string, unknown>): Record<string, unknown> => {
  const { data } = doc;
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
};

/** A page's documents by engine ref, read one engine form at a time. */
const readPage = async (
  page: SubmissionRecord[],
  read: ReadAnswers,
  signal: AbortSignal,
): Promise<Map<string, Record<string, unknown>>> => {
  const refsByForm = new Map<string, string[]>();
  page.forEach(({ engineSchemaRef, engineSubmissionRef }) => {
    if (!engineSchemaRef || !engineSubmissionRef) return;
    const refs = refsByForm.get(engineSchemaRef) ?? [];
    refs.push(engineSubmissionRef);
    refsByForm.set(engineSchemaRef, refs);
  });
  const results = await mapInOrder([...refsByForm], ([formRef, refs]) =>
    read(formRef, refs, signal),
  );
  return new Map(results.flatMap(({ found }) => [...found]));
};

/** A page's rows in the query's order; a submission without a document is counted, not written. */
const pageRows = async (
  page: SubmissionRecord[],
  read: ReadAnswers,
  { signal, onUnread }: ExportRowsOptions,
): Promise<ExportRow[]> => {
  signal.throwIfAborted();
  const docs = await readPage(page, read, signal);
  const rows = page.flatMap((record): ExportRow[] => {
    const doc = record.engineSubmissionRef ? docs.get(record.engineSubmissionRef) : undefined;
    if (!doc) return [];
    return [
      {
        submissionId: record.submissionId,
        confirmationCode: record.confirmationCode,
        versionId: record.versionId,
        submittedAt: record.submittedAt,
        submitter: record.submitter,
        username: record.username,
        email: record.email,
        answers: answersIn(doc),
      },
    ];
  });
  if (rows.length < page.length) onUnread(page.length - rows.length);
  return rows;
};

/** Each page as rows, the next page read only once the previous one has been taken. */
const rowPages = (
  pages: AsyncIterable<SubmissionRecord[]>,
  read: ReadAnswers,
  options: ExportRowsOptions,
): AsyncIterable<ExportRow[]> => ({
  [Symbol.asyncIterator]: () => {
    const source = pages[Symbol.asyncIterator]();
    return {
      next: async (): Promise<IteratorResult<ExportRow[], undefined>> => {
        const page = await source.next();
        if (page.done) return { done: true, value: undefined };
        return { done: false, value: await pageRows(page.value, read, options) };
      },
    };
  },
});

/** The rows of each page in turn. */
async function* eachRow(pages: AsyncIterable<ExportRow[]>): AsyncGenerator<ExportRow> {
  for await (const rows of pages) yield* rows;
}

/** An export source over a submissions query, with each page's answers read from the form engine. */
export const engineExportSource = (query: SubmissionQuery, read: ReadAnswers): ExportSource => ({
  count: (bounds) => query.count(bounds),
  rows: (bounds, options) =>
    eachRow(
      rowPages(
        query.pages(bounds, { pageSize: options.pageSize, signal: options.signal }),
        read,
        options,
      ),
    ),
});
