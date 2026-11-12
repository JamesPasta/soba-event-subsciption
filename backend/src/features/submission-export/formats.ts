import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { flatten, unwind } from '@json2csv/transforms';
import {
  SUBMISSION_EXPORT_LAYOUTS,
  type SubmissionExportFormat,
  type SubmissionExportLayout,
} from '@soba/lib';
import { getTempStorageAdapter } from '../../core/integrations/plugins/PluginRegistry';
import { addressFields, exportFieldNames } from './schemaFields';
import { sizeLimit } from './sizeLimit';
import type { ExportRow } from './source';
import { SUBMISSION_FIELDS } from './submissionFields';

export interface ExportWriteOptions {
  /** CSV: the fields to write, in order. */
  fields: string[];
  /** CSV: how rows with repeated answers are laid out. */
  layout?: SubmissionExportLayout;
  /** The form version schemas the rows were submitted against. */
  schemas: Record<string, unknown>[];
  /** CSV: the most the spooled rows may take, as for the file. */
  maxBytes: number;
  signal: AbortSignal;
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

// A number cannot hold a formula, and the guard would turn a negative one into text.
const csvCell = (value: unknown): string =>
  typeof value === 'number' ? String(value) : quoteCell(cellText(value));

/** One cell of a laid-out row: its column, the column's path without indexes, and the answer. */
interface Cell {
  column: string;
  field: string;
  indexes: number[];
  value: unknown;
}

/** One spooled submission laid out as CSV rows. */
type Layout = (record: Record<string, unknown>, addresses: string[]) => Cell[][];

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** The path is the field or sits under it. */
const within = (path: string, field: string) => path === field || path.startsWith(`${field}.`);

/** Paths of the record's arrays, parents first; an address keeps its arrays whole. */
const arrayPaths = (value: unknown, path: string, addresses: string[]): string[] => {
  if (value === null || typeof value !== 'object') return [];
  if (addresses.some((address) => within(path, address))) return [];
  if (Array.isArray(value)) {
    return [path, ...value.flatMap((item) => arrayPaths(item, path, addresses))];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    arrayPaths(child, join(path, key), addresses),
  );
};

const flattenObjects = flatten({ objects: true, arrays: false, separator: '.' });

/** One row per array item, as CHEFS 1; `blankOut` leaves a repeated row's other cells empty. */
const multiRow =
  (blankOut: boolean): Layout =>
  (record, addresses) =>
    unwind({ paths: [...new Set(arrayPaths(record, '', addresses))], blankOut })(record).map(
      (row) =>
        Object.entries(flattenObjects(row)).map(([column, value]) => ({
          column,
          field: column,
          indexes: [],
          value,
        })),
    );

/** Each leaf under its indexed column; indexes are tracked, since option values can be numbers. */
const leaves = (value: unknown, column: string, field: string, indexes: number[]): Cell[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      leaves(item, `${column}.${index}`, field, [...indexes, index]),
    );
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, join(column, key), join(field, key), indexes),
    );
  }
  return [{ column, field, indexes, value }];
};

const singleRow: Layout = (record) => [leaves(record, '', '', [])];

const unformatted: Layout = (record) => [
  Object.entries(record).map(([column, value]) => ({ column, field: column, indexes: [], value })),
];

const LAYOUTS: Record<SubmissionExportLayout, Layout> = {
  multiRowEmptySpacesCSVExport: multiRow(true),
  multiRowBackFilledCSVExport: multiRow(false),
  singleRowCSVExport: singleRow,
  unFormattedCSVExport: unformatted,
};

/** The longest schema field the path is or sits under; else the first one under it, or -1. */
const fieldPosition = (path: string, fieldNames: string[]): number => {
  const owner = fieldNames.reduce(
    (best, name, index) =>
      within(path, name) && (best < 0 || name.length > fieldNames[best].length) ? index : best,
    -1,
  );
  return owner >= 0 ? owner : fieldNames.findIndex((name) => within(name, path));
};

/** Array indexes in order, a column with fewer before one it is a prefix of. */
const byIndexes = (a: number[], b: number[]): number => {
  const at = a.findIndex((index, i) => index !== b[i]);
  if (at < 0) return a.length - b.length;
  return at >= b.length ? 1 : a[at] - b[at];
};

interface ColumnRank {
  /** The schema field's position; -1 drops the column. */
  position: number;
  indexes: number[];
  seen: number;
}

/**
 * CSV in a CHEFS 1 layout. The rows are spooled to temp storage while their columns are collected,
 * then read back once the header is known.
 */
export const csvFormat: ExportFormatDefinition = {
  code: 'csv',
  metadata: { name: 'CSV' },
  extension: 'csv',
  contentType: 'text/csv',
  async *serialize(rows, { fields, layout: code, schemas, maxBytes, signal }) {
    const layoutCode = code ?? SUBMISSION_EXPORT_LAYOUTS[0];
    const layout = LAYOUTS[layoutCode];
    const everyField = layoutCode === 'unFormattedCSVExport';
    const addresses = addressFields(schemas);
    const fieldNames = exportFieldNames(schemas);
    const columns = new Map<string, ColumnRank>();
    async function* spoolLines(): AsyncIterable<string> {
      for await (const row of rows) {
        // The submission's facts last, so an answer named `form` cannot replace them.
        const record: Record<string, unknown> = { ...row.answers, form: submissionFacts(row) };
        delete record.submit;
        for (const cell of layout(record, addresses).flat()) {
          if (columns.has(cell.column) || within(cell.column, 'form')) continue;
          const ticked = everyField || fields.some((field) => within(cell.field, field));
          const position = ticked ? fieldPosition(cell.field, fieldNames) : -1;
          columns.set(cell.column, { position, indexes: cell.indexes, seen: columns.size });
        }
        yield `${JSON.stringify(record)}\n`;
      }
    }

    const temp = getTempStorageAdapter();
    const spool = temp.reserve({ prefix: 'export-spool' });
    try {
      await pipeline(
        Readable.from(spoolLines()),
        sizeLimit(maxBytes),
        createWriteStream(spool.path),
        { signal },
      );
      const header = [
        ...(everyField
          ? ['form']
          : Object.keys(SUBMISSION_FIELDS).filter((field) => fields.includes(field))),
        ...[...columns]
          .filter(([, rank]) => rank.position >= 0)
          .sort(
            ([, a], [, b]) =>
              a.position - b.position || byIndexes(a.indexes, b.indexes) || a.seen - b.seen,
          )
          .map(([column]) => column),
      ];
      yield '\uFEFF';
      yield `${header.map(quoteCell).join(',')}\r\n`;

      const input = temp.createReadStream(spool);
      try {
        for await (const line of createInterface({ input, crlfDelay: Infinity })) {
          signal.throwIfAborted();
          for (const cells of layout(JSON.parse(line), addresses)) {
            const values = new Map(cells.map((cell) => [cell.column, cell.value]));
            yield `${header.map((column) => csvCell(values.get(column))).join(',')}\r\n`;
          }
        }
      } finally {
        input.destroy();
      }
    } finally {
      await temp.remove(spool);
    }
  },
};

const FORMATS: Record<SubmissionExportFormat, ExportFormatDefinition> = {
  csv: csvFormat,
  json: jsonFormat,
};

export const exportFormat = (code: SubmissionExportFormat): ExportFormatDefinition => FORMATS[code];
