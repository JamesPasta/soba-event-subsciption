import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  SUBMISSION_EXPORT_LAYOUTS,
  type SubmissionExportFormat,
  type SubmissionExportLayout,
} from '@soba/lib';
import { getTempStorageAdapter } from '../../core/integrations/plugins/PluginRegistry';
import { addressFields, exportFieldNames, parentFields } from './schemaFields';
import { tooLarge } from './sizeLimit';
import type { ExportRow, ExportSchema } from './source';
import { SUBMISSION_FIELDS } from './submissionFields';

export interface ExportWriteOptions {
  /** CSV: the ticked fields; the columns follow the schema's order. */
  fields: string[];
  /** CSV: how rows with repeated answers are laid out. */
  layout?: SubmissionExportLayout;
  /** The form version schemas the rows were submitted against. */
  schemas: ExportSchema[];
  /** The file's size limit; CSV stops early once its rows must pass it. */
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
  /** The file's text, in order; the caller writes it out and enforces the exact size limit. */
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

/**
 * One cell of a laid-out row: its column, the column's path without indexes, the arrays it sits in
 * (each one's path without indexes, and the item's index), and the answer.
 */
interface Cell {
  column: string;
  field: string;
  arrays: Array<[path: string, index: number]>;
  value: unknown;
}

/** One submission laid out as CSV rows, one at a time. */
type Layout = (
  record: Record<string, unknown>,
  unwinds: (path: string) => boolean,
) => Iterable<Cell[]>;

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** The path is the field or sits under it. */
const within = (path: string, field: string) => path === field || path.startsWith(`${field}.`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Each leaf under its column. `indexed` gives each array item its own columns, tracking the index
 * as it goes, since option values can be numbers; otherwise an array is one cell.
 */
const leaves = (
  value: unknown,
  column: string,
  field: string,
  arrays: Cell['arrays'],
  indexed: boolean,
): Cell[] => {
  if (indexed && Array.isArray(value)) {
    return value.flatMap((item, index) =>
      leaves(item, `${column}.${index}`, field, [...arrays, [field, index]], indexed),
    );
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, join(column, key), join(field, key), arrays, indexed),
    );
  }
  return [{ column, field, arrays, value }];
};

/** The keys to each array to unwind, parents first; any other array stays whole. */
const arrayPaths = (
  value: unknown,
  keys: string[],
  unwinds: (path: string) => boolean,
): string[][] => {
  if (Array.isArray(value)) {
    if (!unwinds(keys.join('.'))) return [];
    return [keys, ...value.flatMap((item) => arrayPaths(item, keys, unwinds))];
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    arrayPaths(child, [...keys, key], unwinds),
  );
};

const valueAt = (row: Record<string, unknown>, keys: string[]): unknown =>
  keys.reduce<unknown>(
    (value, key) => (isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined),
    row,
  );

/** A copy of the row with the value at the keys replaced; `undefined` removes it. */
const withValueAt = (
  row: Record<string, unknown>,
  [key, ...rest]: string[],
  value: unknown,
): Record<string, unknown> => {
  if (rest.length > 0) {
    const child = Object.hasOwn(row, key) ? row[key] : undefined;
    return { ...row, [key]: withValueAt(isRecord(child) ? child : {}, rest, value) };
  }
  if (value !== undefined) return { ...row, [key]: value };
  return Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));
};

/**
 * The rows the arrays give, one at a time, as CHEFS 1: each array in turn, parents first, one row
 * per item, sibling arrays crossed. `blankOut` leaves a repeated row's other cells empty.
 */
function* unwound(
  row: Record<string, unknown>,
  paths: string[][],
  blankOut: boolean,
): Generator<Record<string, unknown>> {
  if (paths.length === 0) {
    yield row;
    return;
  }
  const [keys, ...rest] = paths;
  const items = valueAt(row, keys);
  if (!Array.isArray(items)) {
    yield* unwound(row, rest, blankOut);
    return;
  }
  if (items.length === 0) {
    yield* unwound(withValueAt(row, keys, undefined), rest, blankOut);
    return;
  }
  for (const [index, item] of items.entries()) {
    yield* unwound(withValueAt(blankOut && index > 0 ? {} : row, keys, item), rest, blankOut);
  }
}

const multiRow = (blankOut: boolean): Layout =>
  function* (record, unwinds) {
    const paths = new Map(arrayPaths(record, [], unwinds).map((keys) => [keys.join('.'), keys]));
    for (const row of unwound(record, [...paths.values()], blankOut)) {
      yield leaves(row, '', '', [], false);
    }
  };

const singleRow: Layout = (record) => [leaves(record, '', '', [], true)];

const unformatted: Layout = (record) => [
  Object.entries(record).map(([column, value]) => ({ column, field: column, arrays: [], value })),
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

/** Ranks compared item by item; a rank that is the start of another comes first. */
const byRank = (a: number[], b: number[]): number => {
  const at = a.findIndex((item, i) => item !== b[i]);
  if (at < 0) return a.length - b.length;
  return at >= b.length ? 1 : a[at] - b[at];
};

/** A kept column: its id in the spool, and where it sorts. */
interface Column {
  id: number;
  /** Per array it sits in, the array's field position and the item's index; then its field's. */
  rank: number[];
}

/** A spooled cell: its column's id and its CSV text. */
type SpooledCell = [id: number, text: string];

/** How one version's rows are laid out. */
interface VersionRules {
  /** The ticked fields that give a column. */
  columnFields: string[];
  /** Whether the array at the path gives a row per item. */
  unwinds: (arrayPath: string) => boolean;
  /** Whether a cell at the column, under the field, is written. */
  keeps: (column: string, field: string) => boolean;
}

/** The map's value for the key, worked out the first time it is asked for. */
const cached = <V>(map: Map<string, V>, key: string, work: () => V): V => {
  const known = map.get(key);
  if (known !== undefined) return known;
  const value = work();
  map.set(key, value);
  return value;
};

/**
 * A version's rules, from its own fields, those holding fields and its addresses. Every row asks
 * about the same arrays and columns, so the answers are kept.
 */
const versionRules = (
  ticked: Set<string>,
  everyField: boolean,
  version: ExportSchema,
): VersionRules => {
  const own = exportFieldNames([version]);
  const parents = parentFields([version]);
  const addresses = addressFields(version.schema);
  const owners = new Map<string, number>();
  /** The version's field the path is or sits under, as `fieldPosition` finds it. */
  const ownerOf = (path: string): string | undefined =>
    own[cached(owners, path, () => fieldPosition(path, own))];
  /** The path's column comes from a ticked field: one with no fields under it, or one above it. */
  const tickedOwner = (path: string): boolean => {
    const owner = ownerOf(path);
    return owner !== undefined && ticked.has(owner) && (!parents.has(owner) || owner !== path);
  };
  const columnFields = own.filter((name) => ticked.has(name) && !parents.has(name));
  // An array unwinds only when it holds a ticked column.
  const holdsColumn = (arrayPath: string): boolean =>
    columnFields.some((name) => name.startsWith(`${arrayPath}.`)) || tickedOwner(arrayPath);
  const unwound = new Map<string, boolean>();
  const kept = new Map<string, boolean>();
  return {
    columnFields,
    // An address's own list unwinds, as CHEFS 1; the provider's result inside it stays whole.
    unwinds: (arrayPath) =>
      !addresses.some((address) => arrayPath.startsWith(`${address}.`)) &&
      cached(unwound, arrayPath, () => holdsColumn(arrayPath)),
    keeps: (column, field) =>
      cached(
        kept,
        column,
        () => ownerOf(field) !== undefined && (everyField || tickedOwner(field)),
      ),
  };
};

/** For a row whose version has no schema: what any version would do. */
const anyVersionRules = (versions: VersionRules[]): VersionRules => ({
  columnFields: [],
  unwinds: (arrayPath) => versions.some((rules) => rules.unwinds(arrayPath)),
  keeps: (column, field) => versions.some((rules) => rules.keeps(column, field)),
});

// JSON leaves these two line separators unescaped, and readline would end a line at either.
const LINE_SEPARATORS = new RegExp(`[${String.fromCodePoint(0x2028, 0x2029)}]`, 'g');

const spoolLine = (cells: SpooledCell[]): string =>
  JSON.stringify(cells).replace(
    LINE_SEPARATORS,
    (separator) => String.raw`\u${separator.codePointAt(0)?.toString(16)}`,
  );

/**
 * CSV in a CHEFS 1 layout. Each row's ticked cells are spooled to temp storage as they are laid
 * out, then placed under the header once every column is known.
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
    const ticked = new Set(fields);
    const fieldNames = exportFieldNames(schemas);
    const positions = new Map<string, number>();
    const positionOf = (path: string): number =>
      cached(positions, path, () => fieldPosition(path, fieldNames));

    // A key can be a grid in one version and a text field, a file or an address in another.
    const rulesByVersion = new Map(
      schemas.map((version) => [version.versionId, versionRules(ticked, everyField, version)]),
    );
    const noVersion = anyVersionRules([...rulesByVersion.values()]);

    const columns = new Map<string, Column>();
    const add = (name: string, rank: number[]): Column => {
      const column = { id: columns.size, rank };
      columns.set(name, column);
      return column;
    };
    const formColumns = everyField
      ? ['form']
      : Object.keys(SUBMISSION_FIELDS).filter((field) => ticked.has(field));
    for (const name of formColumns) add(name, [-1]);
    // Multi-row lists every ticked field that gives a column, as CHEFS 1, answered or not.
    if (
      layoutCode === 'multiRowEmptySpacesCSVExport' ||
      layoutCode === 'multiRowBackFilledCSVExport'
    ) {
      const given = new Set([...rulesByVersion.values()].flatMap((rules) => rules.columnFields));
      fieldNames.forEach((name, position) => {
        if (given.has(name) && !within(name, 'form')) add(name, [position]);
      });
    }
    /** The cell's column, or null when no ticked field gives it in the row's version. */
    const columnOf = (
      { column: name, field, arrays }: Cell,
      rules: VersionRules,
    ): Column | null => {
      // The submission's facts are added up front when ticked.
      if (within(name, 'form')) return columns.get(name) ?? null;
      if (!rules.keeps(name, field)) return null;
      const known = columns.get(name);
      if (known) return known;
      const rank = arrays.flatMap(([array, index]) => [positionOf(array), index]);
      return add(name, [...rank, positionOf(field)]);
    };
    /** The cells written for a row; an empty one is left out, as reading back fills it. */
    const spooledCells = (cells: Cell[], rules: VersionRules): SpooledCell[] =>
      cells.flatMap((cell): SpooledCell[] => {
        const column = columnOf(cell, rules);
        const text = column ? csvCell(cell.value) : '';
        return column && text ? [[column.id, text]] : [];
      });

    async function* spoolLines(): AsyncIterable<string> {
      let leastBytes = 0;
      for await (const row of rows) {
        // The submission's facts last, so an answer named `form` cannot replace them.
        const record: Record<string, unknown> = { ...row.answers, form: submissionFacts(row) };
        const rules = rulesByVersion.get(row.versionId) ?? noVersion;
        for (const cells of layout(record, rules.unwinds)) {
          const spooled = spooledCells(cells, rules);
          // The least the row adds to the CSV: its cells, a comma per column so far, and CRLF.
          leastBytes += spooled.reduce(
            (bytes, [, text]) => bytes + Buffer.byteLength(text),
            columns.size + 1,
          );
          if (leastBytes > maxBytes) throw tooLarge(maxBytes);
          yield `${spoolLine(spooled)}\n`;
        }
      }
    }

    const temp = getTempStorageAdapter();
    const spool = temp.reserve({ prefix: 'export-spool' });
    try {
      await pipeline(Readable.from(spoolLines()), createWriteStream(spool.path), { signal });
      const header = [...columns].sort(([, a], [, b]) => byRank(a.rank, b.rank) || a.id - b.id);
      const slots: number[] = [];
      header.forEach(([, column], slot) => {
        slots[column.id] = slot;
      });
      yield '\uFEFF';
      yield `${header.map(([name]) => quoteCell(name)).join(',')}\r\n`;

      const input = temp.createReadStream(spool);
      try {
        for await (const line of createInterface({ input, crlfDelay: Infinity })) {
          signal.throwIfAborted();
          const cells = new Array<string>(header.length).fill('');
          for (const [id, text] of JSON.parse(line) as SpooledCell[]) cells[slots[id]] = text;
          yield `${cells.join(',')}\r\n`;
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
