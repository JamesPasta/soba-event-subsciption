import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SubmissionExportLayout } from '@soba/lib';
import { createDiskTempStorageAdapter } from '../../../src/core/integrations/temp-storage/diskTempStorage';
import { JobFailedError } from '../../../src/core/jobs/settlement';
import {
  csvFormat,
  jsonFormat,
  type ExportWriteOptions,
} from '../../../src/features/submission-export/formats';
import { exportFileName } from '../../../src/features/submission-export/job';
import {
  flattenComponents,
  type FormComponent,
} from '../../../src/features/submission-export/schemaFields';
import { EXPORT_TOO_LARGE } from '../../../src/features/submission-export/sizeLimit';
import type { ExportRow } from '../../../src/features/submission-export/source';

const SPOOL_DIR = path.join(os.tmpdir(), `soba-export-test-${process.pid}`);

jest.mock('../../../src/core/integrations/plugins/PluginRegistry', () => ({
  getTempStorageAdapter: () => mockTempStorage(),
}));

// Hoisted, so the mock can call it; the spools land in SPOOL_DIR.
function mockTempStorage() {
  return createDiskTempStorageAdapter(SPOOL_DIR);
}

afterEach(() => {
  // Every spool is removed, whether the export succeeded, failed or was stopped.
  if (fs.existsSync(SPOOL_DIR)) expect(fs.readdirSync(SPOOL_DIR)).toEqual([]);
});

afterAll(() => fs.rmSync(SPOOL_DIR, { recursive: true, force: true }));

const rows: ExportRow[] = [
  {
    submissionId: 's1',
    confirmationCode: 'AB12CD34',
    versionId: 'v1',
    submittedAt: '2026-10-01T16:05:00.000Z',
    submitter: 'Sam',
    username: 'sam.sample',
    email: 'sam.sample@example.com',
    answers: {
      applicantName: 'Morgan "Mo", Test',
      dependants: [
        { name: 'Casey', age: 12 },
        { name: 'Riley', age: 4 },
      ],
    },
  },
  {
    submissionId: 's2',
    confirmationCode: 'EF56GH78',
    versionId: 'v1',
    submittedAt: '2026-10-02T16:05:00.000Z',
    submitter: 'public',
    username: '',
    email: '',
    answers: {},
  },
];

const components: FormComponent[] = [
  { type: 'textfield', key: 'applicantName', input: true },
  {
    type: 'datagrid',
    key: 'dependants',
    input: true,
    tree: true,
    components: [
      { type: 'textfield', key: 'name', input: true },
      { type: 'number', key: 'age', input: true },
      {
        type: 'datagrid',
        key: 'pets',
        input: true,
        tree: true,
        components: [{ type: 'textfield', key: 'kind', input: true }],
      },
    ],
  },
  { type: 'file', key: 'upload', input: true },
  { type: 'selectboxes', key: 'sel', input: true, values: [{ value: '1' }, { value: '1.5' }] },
  {
    type: 'address',
    key: 'addr',
    input: true,
    tree: true,
    enableManualMode: true,
    components: [
      { type: 'textfield', key: 'address1', input: true },
      { type: 'textfield', key: 'city', input: true },
    ],
  },
  { type: 'address', key: 'home', input: true },
  {
    type: 'datagrid',
    key: 'mailingAddresses',
    input: true,
    tree: true,
    components: [{ type: 'textfield', key: 'street', input: true }],
  },
  { type: 'number', key: 'count', input: true },
  { type: 'button', key: 'submit', input: true },
];

async function* each<T>(items: T[]): AsyncIterable<T> {
  yield* items;
}

const collect = async (text: AsyncIterable<string>): Promise<string> => {
  let all = '';
  for await (const chunk of text) all += chunk;
  return all;
};

const writeOptions = (options: Partial<ExportWriteOptions> = {}): ExportWriteOptions => ({
  fields: ['form.confirmationId', ...flattenComponents(components)],
  schemas: [{ components }],
  maxBytes: 1_000_000,
  signal: new AbortController().signal,
  ...options,
});

/** Each submission's answers on the public row, written as CSV and split into lines. */
const csvLines = async (
  answers: Record<string, unknown>[],
  options: Partial<ExportWriteOptions> = {},
): Promise<string[]> => {
  const exported = answers.map((answer, index) => ({
    ...rows[1],
    submissionId: `s${index}`,
    answers: answer,
  }));
  const text = await collect(csvFormat.serialize(each(exported), writeOptions(options)));
  expect(text.startsWith('\uFEFF')).toBe(true);
  return text.slice(1).split('\r\n');
};

const LAYOUTS: SubmissionExportLayout[] = [
  'multiRowEmptySpacesCSVExport',
  'multiRowBackFilledCSVExport',
  'singleRowCSVExport',
  'unFormattedCSVExport',
];

describe('csvFormat, every layout', () => {
  it.each<[SubmissionExportLayout, string]>([
    [
      'multiRowEmptySpacesCSVExport',
      'form.confirmationId,applicantName,upload.name,upload.url,count',
    ],
    [
      'multiRowBackFilledCSVExport',
      'form.confirmationId,applicantName,upload.name,upload.url,count',
    ],
    ['singleRowCSVExport', 'form.confirmationId,applicantName,upload.0.name,upload.0.url,count'],
    ['unFormattedCSVExport', 'form,applicantName,upload,count'],
  ])('%s writes a BOM, then columns in schema order', async (layout, header) => {
    const lines = await csvLines(
      [{ count: 3, upload: [{ name: 'a.pdf', url: '/f/1' }], applicantName: 'Zoë', stray: 'x' }],
      { layout },
    );
    expect(lines[0]).toBe(header);
  });

  it.each<[SubmissionExportLayout, string]>([
    ['multiRowEmptySpacesCSVExport', 'form.confirmationId,dependants.name,dependants.age'],
    ['multiRowBackFilledCSVExport', 'form.confirmationId,dependants.name,dependants.age'],
    ['singleRowCSVExport', 'form.confirmationId,dependants.0.name,dependants.0.age'],
    ['unFormattedCSVExport', 'form,applicantName,dependants'],
  ])('%s: a ticked grid pulls in its columns', async (layout, header) => {
    const lines = await csvLines(
      [{ applicantName: 'Sam', dependants: [{ name: 'Casey', age: 12 }] }],
      {
        layout,
        fields: ['form.confirmationId', 'dependants'],
      },
    );
    expect(lines[0]).toBe(header);
  });

  it.each(LAYOUTS.filter((layout) => layout !== 'unFormattedCSVExport'))(
    '%s: an unticked grid leaves its columns and rows out',
    async (layout) => {
      const lines = await csvLines(
        [{ applicantName: 'Sam', dependants: [{ name: 'Casey' }, { name: 'Riley' }] }],
        {
          layout,
          fields: ['form.confirmationId', 'applicantName'],
        },
      );
      expect(lines).toEqual(['form.confirmationId,applicantName', 'EF56GH78,Sam', '']);
    },
  );

  it.each(LAYOUTS)('%s guards a formula and leaves a number as a number', async (layout) => {
    const lines = await csvLines([{ applicantName: '=1+1', count: -5 }], {
      layout,
      fields: ['form.confirmationId', 'applicantName', 'count'],
    });
    expect(lines[1].endsWith(`,'=1+1,-5`)).toBe(true);
  });

  it.each<[SubmissionExportLayout, string]>([
    ['multiRowEmptySpacesCSVExport', 'form.confirmationId'],
    ['multiRowBackFilledCSVExport', 'form.confirmationId'],
    ['singleRowCSVExport', 'form.confirmationId'],
    ['unFormattedCSVExport', 'form'],
  ])('%s writes only the header when there are no rows', async (layout, header) => {
    expect(await csvLines([], { layout })).toEqual([header, '']);
  });
});

describe('csvFormat, single row', () => {
  const layout = 'singleRowCSVExport';

  it('indexes columns up to the longest grid across rows, by field then index', async () => {
    const lines = await csvLines(
      [
        { dependants: [{ name: 'Casey', age: 12 }] },
        { dependants: [{ name: 'Riley', age: 4 }, { name: 'Jo' }] },
      ],
      { layout, fields: ['form.confirmationId', 'dependants'] },
    );
    expect(lines).toEqual([
      'form.confirmationId,dependants.0.name,dependants.1.name,dependants.0.age',
      'EF56GH78,Casey,,12',
      'EF56GH78,Riley,Jo,4',
      '',
    ]);
  });

  it('keeps a numeric option value, and one holding dots, as fields', async () => {
    const lines = await csvLines([{ sel: { '1': true, '1.5': false } }], {
      layout,
      fields: ['sel.1', 'sel.1.5'],
    });
    expect(lines.slice(0, 2)).toEqual(['sel.1,sel.1.5', 'true,false']);
  });

  it('finds the parts of a manual address under its address key', async () => {
    const lines = await csvLines(
      [{ addr: { mode: 'manual', address: { address1: '1 Main St', city: 'Victoria' } } }],
      { layout, fields: ['addr'] },
    );
    expect(lines.slice(0, 2)).toEqual([
      'addr.mode,addr.address.address1,addr.address.city',
      'manual,1 Main St,Victoria',
    ]);
  });
});

describe('csvFormat, multi-row', () => {
  const fields = ['form.confirmationId', 'applicantName', 'dependants'];
  const answers = { applicantName: 'Sam', dependants: [{ name: 'Casey' }, { name: 'Riley' }] };

  it('leaves the other cells of a repeated row blank with indentation spaces', async () => {
    expect(await csvLines([answers], { layout: 'multiRowEmptySpacesCSVExport', fields })).toEqual([
      'form.confirmationId,applicantName,dependants.name',
      'EF56GH78,Sam,Casey',
      ',,Riley',
      '',
    ]);
  });

  it('fills the other cells of a repeated row when back-filled', async () => {
    expect(await csvLines([answers], { layout: 'multiRowBackFilledCSVExport', fields })).toEqual([
      'form.confirmationId,applicantName,dependants.name',
      'EF56GH78,Sam,Casey',
      'EF56GH78,Sam,Riley',
      '',
    ]);
  });

  it('unwinds a grid inside a grid', async () => {
    const lines = await csvLines(
      [
        {
          dependants: [
            { name: 'Casey', pets: [{ kind: 'cat' }, { kind: 'dog' }] },
            { name: 'Riley' },
          ],
        },
      ],
      { layout: 'multiRowBackFilledCSVExport', fields: ['dependants'] },
    );
    expect(lines).toEqual([
      'dependants.name,dependants.pets.kind',
      'Casey,cat',
      'Casey,dog',
      'Riley,',
      '',
    ]);
  });

  it('keeps an address whole but unwinds a grid named like one', async () => {
    const lines = await csvLines(
      [
        {
          home: { coordinates: [48.4, -123.3] },
          mailingAddresses: [{ street: '1 A St' }, { street: '2 B St' }],
        },
      ],
      { layout: 'multiRowBackFilledCSVExport', fields: ['home', 'mailingAddresses'] },
    );
    expect(lines).toEqual([
      'home.coordinates,mailingAddresses.street',
      '"[48.4,-123.3]",1 A St',
      '"[48.4,-123.3]",2 B St',
      '',
    ]);
  });

  it('writes each number in a grid as a number', async () => {
    const lines = await csvLines([{ dependants: [{ age: -1 }, { age: 2 }] }], {
      layout: 'multiRowBackFilledCSVExport',
      fields: ['dependants.age'],
    });
    expect(lines).toEqual(['dependants.age', '-1', '2', '']);
  });
});

describe('csvFormat, unformatted', () => {
  it('writes the top-level answers in schema order, nested ones as JSON', async () => {
    const lines = await csvLines(
      [{ sel: { '1': true }, dependants: [{ name: 'Casey' }], applicantName: 'Sam' }],
      { layout: 'unFormattedCSVExport', fields: [] },
    );
    expect(lines[0]).toBe('form,applicantName,dependants,sel');
    expect(lines[1].startsWith('"{""confirmationId"":""EF56GH78""')).toBe(true);
    expect(lines[1].endsWith(',Sam,"[{""name"":""Casey""}]","{""1"":true}"')).toBe(true);
  });
});

describe('csvFormat cells', () => {
  const cellOf = async (answer: unknown): Promise<string> =>
    (await csvLines([{ applicantName: answer }], { fields: ['applicantName'] }))[1];

  it.each(['=HYPERLINK("http://x")', '+1', '-2', '@SUM(A1)', '\tx'])(
    'writes %j so a spreadsheet reads it as text',
    async (value) => {
      const cell = await cellOf(value);
      expect(cell.replace(/^"|"$/g, '').startsWith(`'`)).toBe(true);
    },
  );

  it('quotes a cell holding quotes, commas or line breaks', async () => {
    expect(await cellOf(rows[0].answers.applicantName)).toBe('"Morgan ""Mo"", Test"');
    expect(await cellOf('line one\nline two')).toBe('"line one\nline two"');
  });

  it('reads a field named like an inherited property as an answer', async () => {
    const lines = await csvLines([{ constructor: 'built' }], {
      fields: ['constructor', 'valueOf'],
      schemas: [
        {
          components: [
            { type: 'textfield', key: 'constructor', input: true },
            { type: 'textfield', key: 'valueOf', input: true },
          ],
        },
      ],
    });
    expect(lines).toEqual(['constructor', 'built', '']);
  });

  it("writes the submitter's facts", async () => {
    const text = await collect(
      csvFormat.serialize(
        each(rows),
        writeOptions({
          fields: ['form.submitter', 'form.username', 'form.email', 'applicantName'],
        }),
      ),
    );
    expect(text.slice(1).split('\r\n')).toEqual([
      'form.submitter,form.username,form.email,applicantName',
      'Sam,sam.sample,sam.sample@example.com,"Morgan ""Mo"", Test"',
      'public,,,',
      '',
    ]);
  });
});

describe('csvFormat spool', () => {
  it('fails as too large once the spooled rows pass maxBytes', async () => {
    const written = collect(csvFormat.serialize(each(rows), writeOptions({ maxBytes: 100 })));
    await expect(written).rejects.toThrow(JobFailedError);
    await expect(
      collect(csvFormat.serialize(each(rows), writeOptions({ maxBytes: 100 }))),
    ).rejects.toThrow(EXPORT_TOO_LARGE);
  });

  it('removes the spool when reading the rows fails', async () => {
    async function* failing(): AsyncIterable<ExportRow> {
      yield rows[0];
      throw new Error('read failed');
    }
    await expect(collect(csvFormat.serialize(failing(), writeOptions()))).rejects.toThrow(
      'read failed',
    );
  });

  it('stops with the reason once aborted while writing', async () => {
    const controller = new AbortController();
    const text = csvFormat.serialize(each(rows), writeOptions({ signal: controller.signal }));
    const chunks = text[Symbol.asyncIterator]();
    expect((await chunks.next()).value).toBe('\uFEFF');
    await chunks.next();
    controller.abort(new Error('stopped'));
    await expect(chunks.next()).rejects.toThrow('stopped');
  });
});

describe('jsonFormat', () => {
  it("keeps the submission's facts when an answer is named form", async () => {
    const parsed = JSON.parse(
      await collect(
        jsonFormat.serialize(
          each([{ ...rows[1], answers: { form: 'mine', other: 1 } }]),
          writeOptions({ fields: [], schemas: [] }),
        ),
      ),
    );
    expect(parsed[0].form.confirmationId).toBe('EF56GH78');
    expect(parsed[0].other).toBe(1);
  });

  it('writes an array of submissions with their facts under form', async () => {
    const parsed = JSON.parse(
      await collect(jsonFormat.serialize(each(rows), writeOptions({ fields: [], schemas: [] }))),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      form: {
        confirmationId: 'AB12CD34',
        submissionId: 's1',
        formVersionId: 'v1',
        submittedAt: '2026-10-01T16:05:00.000Z',
        submitter: 'Sam',
        username: 'sam.sample',
        email: 'sam.sample@example.com',
      },
      ...rows[0].answers,
    });
    expect(parsed[1].form).toMatchObject({ submitter: 'public', username: '', email: '' });
  });

  it('writes an empty array when there is nothing to export', async () => {
    expect(
      JSON.parse(
        await collect(jsonFormat.serialize(each([]), writeOptions({ fields: [], schemas: [] }))),
      ),
    ).toEqual([]);
  });
});

describe('exportFileName', () => {
  it('names the file after the form and the day it was started in BC', () => {
    expect(exportFileName('Permit Intake', new Date('2026-10-30T05:30:00Z'), 'csv')).toBe(
      'Permit Intake 2026-10-29.csv',
    );
  });

  it('keeps accents and drops characters file systems refuse', () => {
    expect(exportFileName('Résumé: a/b\\c*?"<>|', new Date('2026-10-29T20:00:00Z'), 'json')).toBe(
      'Résumé a b c 2026-10-29.json',
    );
    expect(exportFileName('///', new Date('2026-10-29T20:00:00Z'), 'csv')).toBe(
      'Submissions 2026-10-29.csv',
    );
  });
});
