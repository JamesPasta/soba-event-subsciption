import type { SubmissionExportFormat, SubmissionExportLayout } from '@soba/lib';
import type { ExportRow } from './source';

export interface ExportWriteOptions {
  /** CSV: the fields to write, in order. */
  fields: string[];
  /** CSV: how rows with repeated answers are laid out. */
  layout?: SubmissionExportLayout;
  /** The form version schemas the rows were submitted against. */
  schemas: unknown[];
}

/** A file format an export can be written in. */
export interface ExportFormatDefinition {
  code: SubmissionExportFormat;
  metadata: { name: string };
  featureCode?: string;
  extension: string;
  contentType: string;
  options?: Record<string, unknown>;
  /** The file's text, in order; the caller writes it out and enforces the size limit. */
  serialize(rows: AsyncIterable<ExportRow>, options: ExportWriteOptions): AsyncIterable<string>;
}

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

const submissionFacts = (row: ExportRow): Record<string, string> =>
  Object.fromEntries(
    Object.entries(SUBMISSION_FIELDS).map(([field, read]) => [
      field.slice('form.'.length),
      read(row),
    ]),
  );

export const jsonFormat: ExportFormatDefinition = {
  code: 'json',
  metadata: { name: 'JSON' },
  extension: 'json',
  contentType: 'application/json',
  async *serialize(rows) {
    let first = true;
    yield '[';
    for await (const row of rows) {
      // The submission's facts last, so an answer named `form` cannot replace them.
      yield `${first ? '\n' : ',\n'}${JSON.stringify({ ...row.answers, form: submissionFacts(row) })}`;
      first = false;
    }
    yield first ? ']\n' : '\n]\n';
  },
};

/**
 * The values at a dotted path; a list along the way gives one value per item. An option's value can
 * hold dots, so the key is the longest run of the path's parts that matches one.
 */
const valuesAt = (value: unknown, path: string[]): unknown[] => {
  if (path.length === 0) return value === undefined ? [] : [value];
  if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, path));
  if (value === null || typeof value !== 'object') return [];
  const answers = value as Record<string, unknown>;
  const keys = path.map((_, index) => path.slice(0, index + 1).join('.'));
  const found = keys.findLastIndex((key) => Object.hasOwn(answers, key));
  return found < 0 ? [] : valuesAt(answers[keys[found]], path.slice(found + 1));
};

/** An answer as cell text; answers are JSON, so anything not a scalar is written as JSON. */
const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

/**
 * RFC 4180 quoting, after a leading `'` on a cell a spreadsheet would read as a formula. Any
 * layout must keep the guard.
 */
const quoteCell = (raw: string): string => {
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csvCell = (row: ExportRow, field: string): string => {
  if (Object.hasOwn(SUBMISSION_FIELDS, field)) return quoteCell(SUBMISSION_FIELDS[field](row));
  const values = valuesAt(row.answers, field.split('.'));
  const text = values.map(cellText).join('; ');
  // A number cannot hold a formula, and the guard would turn a negative one into text.
  return values.every((value) => typeof value === 'number') ? text : quoteCell(text);
};

/**
 * Placeholder CSV until the CHEFS layouts are in: a header of the fields and one line per
 * submission, a repeated answer's values joined. The layout is not applied.
 */
export const csvFormat: ExportFormatDefinition = {
  code: 'csv',
  metadata: { name: 'CSV' },
  extension: 'csv',
  contentType: 'text/csv',
  async *serialize(rows, { fields }) {
    yield `${fields.map(quoteCell).join(',')}\r\n`;
    for await (const row of rows) {
      yield `${fields.map((field) => csvCell(row, field)).join(',')}\r\n`;
    }
  },
};

const FORMATS: Record<SubmissionExportFormat, ExportFormatDefinition> = {
  csv: csvFormat,
  json: jsonFormat,
};

export const exportFormat = (code: SubmissionExportFormat): ExportFormatDefinition => FORMATS[code];
