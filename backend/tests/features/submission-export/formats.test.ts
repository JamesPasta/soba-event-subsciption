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
import { staffFileLinked } from '../../../src/features/submission-export/fileLinks';
import { exportFileName } from '../../../src/features/submission-export/job';
import {
  flattenComponents,
  type FormComponent,
} from '../../../src/features/submission-export/schemaFields';
import { EXPORT_TOO_LARGE } from '../../../src/features/submission-export/sizeLimit';
import type { ExportRow, ExportSchema } from '../../../src/features/submission-export/source';
import type { TempResource } from '../../../src/core/integrations/temp-storage/TempStorageAdapter';

const SPOOL_DIR = path.join(os.tmpdir(), `soba-export-test-${process.pid}`);

jest.mock('../../../src/core/integrations/plugins/PluginRegistry', () => ({
  getTempStorageAdapter: () => mockTempStorage(),
}));

// Each spool's size as it is removed.
const spoolSizes: number[] = [];

// Hoisted, so the mock can call it; the spools land in SPOOL_DIR.
function mockTempStorage() {
  const storage = createDiskTempStorageAdapter(SPOOL_DIR);
  return {
    ...storage,
    async remove(spool: TempResource) {
      if (fs.existsSync(spool.path)) spoolSizes.push(fs.statSync(spool.path).size);
      await storage.remove(spool);
    },
  };
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
  { type: 'address', key: 'sites', input: true, multiple: true },
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
  schemas: [{ versionId: 'v1', schema: { components } }],
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

/** Each submission written against its version's schema, as CSV split into lines. */
const versionLines = async (
  schemas: ExportSchema[],
  answers: Array<Pick<ExportRow, 'versionId' | 'answers'>>,
  options: Partial<ExportWriteOptions>,
): Promise<string[]> => {
  const exported = answers.map((answer, index) => ({
    ...rows[1],
    submissionId: `s${index}`,
    ...answer,
  }));
  const text = await collect(
    csvFormat.serialize(each(exported), writeOptions({ schemas, ...options })),
  );
  return text.slice(1).split('\r\n');
};

const textField = (key: string): FormComponent => ({ type: 'textfield', key, input: true });

const LAYOUTS: SubmissionExportLayout[] = [
  'multiRowEmptySpacesCSVExport',
  'multiRowBackFilledCSVExport',
  'singleRowCSVExport',
  'unFormattedCSVExport',
];

describe('csvFormat, every layout', () => {
  it.each<[SubmissionExportLayout, string, string]>([
    [
      'multiRowEmptySpacesCSVExport',
      'form.confirmationId,applicantName,upload,upload.name,upload.url,count',
      'EF56GH78,Zoë,,a.pdf,/f/1,3',
    ],
    [
      'multiRowBackFilledCSVExport',
      'form.confirmationId,applicantName,upload,upload.name,upload.url,count',
      'EF56GH78,Zoë,,a.pdf,/f/1,3',
    ],
    [
      'singleRowCSVExport',
      'form.confirmationId,applicantName,upload.0.name,upload.0.url,count',
      'EF56GH78,Zoë,a.pdf,/f/1,3',
    ],
    [
      'unFormattedCSVExport',
      'form,applicantName,upload,count',
      ',Zoë,"[{""name"":""a.pdf"",""url"":""/f/1""}]",3',
    ],
  ])('%s writes a BOM, then columns in schema order', async (layout, header, rowEnd) => {
    const lines = await csvLines(
      [{ count: 3, upload: [{ name: 'a.pdf', url: '/f/1' }], applicantName: 'Zoë', stray: 'x' }],
      { layout, fields: ['form.confirmationId', 'applicantName', 'upload', 'count'] },
    );
    expect(lines[0]).toBe(header);
    expect(lines[1].endsWith(rowEnd)).toBe(true);
  });

  it.each<[SubmissionExportLayout, string]>([
    ['multiRowEmptySpacesCSVExport', 'form.confirmationId,dependants.name'],
    ['multiRowBackFilledCSVExport', 'form.confirmationId,dependants.name'],
    ['singleRowCSVExport', 'form.confirmationId,dependants.0.name'],
    ['unFormattedCSVExport', 'form,applicantName,dependants'],
  ])("%s: a grid's column follows its own field's tick", async (layout, header) => {
    const lines = await csvLines(
      [{ applicantName: 'Sam', dependants: [{ name: 'Casey', age: 12 }] }],
      { layout, fields: ['form.confirmationId', 'dependants', 'dependants.name'] },
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
    ['multiRowEmptySpacesCSVExport', 'form.confirmationId,applicantName,dependants.name'],
    ['multiRowBackFilledCSVExport', 'form.confirmationId,applicantName,dependants.name'],
    ['singleRowCSVExport', 'form.confirmationId'],
    ['unFormattedCSVExport', 'form'],
  ])('%s writes only the header when there are no rows', async (layout, header) => {
    const fields = ['form.confirmationId', 'applicantName', 'dependants', 'dependants.name'];
    expect(await csvLines([], { layout, fields })).toEqual([header, '']);
  });

  it.each(LAYOUTS)("%s leaves out the submit button's value", async (layout) => {
    const lines = await csvLines([{ applicantName: 'Sam', submit: true }], { layout });
    expect(lines[0].split(',')).not.toContain('submit');
  });

  it.each(LAYOUTS.filter((layout) => layout !== 'unFormattedCSVExport'))(
    '%s writes a field keyed submit',
    async (layout) => {
      const schemas = [{ versionId: 'v1', schema: { components: [textField('submit')] } }];
      const lines = await versionLines(schemas, [{ versionId: 'v1', answers: { submit: 'yes' } }], {
        layout,
        fields: ['submit'],
      });
      expect(lines).toEqual(['submit', 'yes', '']);
    },
  );

  it.each(LAYOUTS)('%s escapes line separators in the spool', async (layout) => {
    for (const code of [0x2028, 0x2029]) {
      const text = `a${String.fromCodePoint(code)}b`;
      const lines = await csvLines([{ applicantName: text }], {
        layout,
        fields: ['applicantName'],
      });
      expect(lines[1].endsWith(text)).toBe(true);
    }
  });
});

describe('csvFormat, single row', () => {
  const layout = 'singleRowCSVExport';

  it('indexes columns up to the longest grid across rows, grid row by grid row', async () => {
    const lines = await csvLines(
      [
        { dependants: [{ name: 'Casey', age: 12 }] },
        { dependants: [{ name: 'Riley', age: 4 }, { name: 'Jo' }] },
      ],
      { layout, fields: ['form.confirmationId', 'dependants.name', 'dependants.age'] },
    );
    expect(lines).toEqual([
      'form.confirmationId,dependants.0.name,dependants.0.age,dependants.1.name',
      'EF56GH78,Casey,12,',
      'EF56GH78,Riley,4,Jo',
      '',
    ]);
  });

  it('orders a grid inside a grid by row at each level', async () => {
    const lines = await csvLines(
      [{ dependants: [{ name: 'Casey', pets: [{ kind: 'cat' }] }, { name: 'Riley' }] }],
      { layout, fields: ['dependants.name', 'dependants.pets.kind'] },
    );
    expect(lines[0]).toBe('dependants.0.name,dependants.0.pets.0.kind,dependants.1.name');
  });

  it('keeps a numeric option value, and one holding dots, as fields', async () => {
    const lines = await csvLines([{ sel: { '1': true, '1.5': false } }], {
      layout,
      fields: ['sel.1', 'sel.1.5'],
    });
    expect(lines.slice(0, 2)).toEqual(['sel.1,sel.1.5', 'true,false']);
  });

  it('writes only the ticked option when another option holds its value with dots', async () => {
    const lines = await csvLines([{ sel: { '1': true, '1.5': false } }], {
      layout,
      fields: ['sel.1'],
    });
    expect(lines.slice(0, 2)).toEqual(['sel.1', 'true']);
  });

  it('finds the parts of a manual address under its address key', async () => {
    const lines = await csvLines(
      [{ addr: { mode: 'manual', address: { address1: '1 Main St', city: 'Victoria' } } }],
      { layout, fields: ['addr', 'addr.address.address1', 'addr.address.city'] },
    );
    expect(lines.slice(0, 2)).toEqual([
      'addr.mode,addr.address.address1,addr.address.city',
      'manual,1 Main St,Victoria',
    ]);
  });
});

describe('csvFormat, multi-row', () => {
  const fields = ['form.confirmationId', 'applicantName', 'dependants.name'];
  const answers = { applicantName: 'Sam', dependants: [{ name: 'Casey' }, { name: 'Riley' }] };
  const backFilled: SubmissionExportLayout = 'multiRowBackFilledCSVExport';
  const blankedOut: SubmissionExportLayout = 'multiRowEmptySpacesCSVExport';

  it('leaves the other cells of a repeated row empty', async () => {
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

  const nested = {
    dependants: [{ name: 'Casey', pets: [{ kind: 'cat' }, { kind: 'dog' }] }, { name: 'Riley' }],
  };
  const nestedFields = ['dependants.name', 'dependants.pets.kind'];

  it.each<[SubmissionExportLayout, string[]]>([
    [backFilled, ['Casey,cat', 'Casey,dog', 'Riley,']],
    [blankedOut, ['Casey,cat', ',dog', 'Riley,']],
  ])('%s unwinds a grid inside a grid', async (layout, lines) => {
    expect(await csvLines([nested], { layout, fields: nestedFields })).toEqual([
      'dependants.name,dependants.pets.kind',
      ...lines,
      '',
    ]);
  });

  it.each<[SubmissionExportLayout, string[]]>([
    [backFilled, ['A,1', 'A,2', 'B,1', 'B,2']],
    [blankedOut, ['A,1', ',2', 'B,']],
  ])('%s crosses sibling grids, as CHEFS 1', async (layout, lines) => {
    const siblings = {
      dependants: [{ name: 'A' }, { name: 'B' }],
      mailingAddresses: [{ street: '1' }, { street: '2' }],
    };
    const fields = ['dependants.name', 'mailingAddresses.street'];
    expect(await csvLines([siblings], { layout, fields })).toEqual([
      'dependants.name,mailingAddresses.street',
      ...lines,
      '',
    ]);
  });

  it('lists every ticked schema field, answered or not', async () => {
    const lines = await csvLines([{ count: 1 }], {
      layout: backFilled,
      fields: ['applicantName', 'dependants', 'dependants.name', 'count'],
    });
    expect(lines).toEqual(['applicantName,dependants.name,count', ',,1', '']);
  });

  it.each([backFilled, blankedOut])(
    '%s gives a grid ticked without its fields no rows or columns',
    async (layout) => {
      expect(
        await csvLines([answers], { layout, fields: ['form.confirmationId', 'dependants'] }),
      ).toEqual(['form.confirmationId', 'EF56GH78', '']);
    },
  );

  it.each([backFilled, blankedOut])(
    '%s gives a grid inside a grid, ticked without its fields, no rows',
    async (layout) => {
      const fields = ['form.confirmationId', 'applicantName', 'dependants', 'dependants.pets'];
      expect(await csvLines([{ applicantName: 'Sam', ...nested }], { layout, fields })).toEqual([
        'form.confirmationId,applicantName',
        'EF56GH78,Sam',
        '',
      ]);
    },
  );

  it("keeps what's inside an address whole but unwinds a grid named like one", async () => {
    const lines = await csvLines(
      [
        {
          home: { coordinates: [48.4, -123.3] },
          mailingAddresses: [{ street: '1 A St' }, { street: '2 B St' }],
        },
      ],
      { layout: backFilled, fields: ['home', 'mailingAddresses.street'] },
    );
    expect(lines).toEqual([
      'home,home.coordinates,mailingAddresses.street',
      ',"[48.4,-123.3]",1 A St',
      ',"[48.4,-123.3]",2 B St',
      '',
    ]);
  });

  it('gives each address of a multiple address its own row, as CHEFS 1', async () => {
    const lines = await csvLines([{ sites: [{ label: 'A', geo: [1, 2] }, { label: 'B' }] }], {
      layout: backFilled,
      fields: ['sites'],
    });
    expect(lines).toEqual(['sites,sites.label,sites.geo', ',A,"[1,2]"', ',B,', '']);
  });

  it("uses each version's own addresses", async () => {
    const grid: FormComponent = {
      type: 'datagrid',
      key: 'site',
      input: true,
      tree: true,
      components: [
        {
          type: 'datagrid',
          key: 'rooms',
          input: true,
          tree: true,
          components: [{ type: 'textfield', key: 'label', input: true }],
        },
      ],
    };
    const schemas = [
      { versionId: 'v2', schema: { components: [grid] } },
      { versionId: 'v1', schema: { components: [{ type: 'address', key: 'site', input: true }] } },
    ];
    const row = {
      ...rows[1],
      versionId: 'v2',
      answers: { site: [{ rooms: [{ label: 'a' }, { label: 'b' }] }] },
    };
    const text = await collect(
      csvFormat.serialize(
        each([row]),
        writeOptions({ layout: backFilled, fields: ['site.rooms.label'], schemas }),
      ),
    );
    expect(text.slice(1).split('\r\n')).toEqual(['site.rooms.label', 'a', 'b', '']);
  });

  it('writes each number in a grid as a number', async () => {
    const lines = await csvLines([{ dependants: [{ age: -1 }, { age: 2 }] }], {
      layout: backFilled,
      fields: ['dependants.age'],
    });
    expect(lines).toEqual(['dependants.age', '-1', '2', '']);
  });
});

describe('csvFormat, versions', () => {
  const backFilled: SubmissionExportLayout = 'multiRowBackFilledCSVExport';
  const person: FormComponent = {
    type: 'container',
    key: 'person',
    input: true,
    tree: true,
    components: [textField('first')],
  };
  const personSchemas = [
    { versionId: 'v2', schema: { components: [person] } },
    { versionId: 'v1', schema: { components: [textField('person')] } },
  ];

  it.each<SubmissionExportLayout>([backFilled, 'singleRowCSVExport'])(
    '%s keeps an older answer whose key holds fields in a newer version',
    async (layout) => {
      const lines = await versionLines(
        personSchemas,
        [
          { versionId: 'v1', answers: { person: 'Pat' } },
          { versionId: 'v2', answers: { person: { first: 'Lee' } } },
        ],
        { layout, fields: ['person', 'person.first'] },
      );
      expect(lines).toEqual(['person,person.first', 'Pat,', ',Lee', '']);
    },
  );

  it('unwinds an array only in a version where it holds a ticked column', async () => {
    const grid: FormComponent = {
      type: 'datagrid',
      key: 'x',
      input: true,
      tree: true,
      components: [textField('y')],
    };
    const schemas = [
      { versionId: 'v2', schema: { components: [textField('n'), grid] } },
      {
        versionId: 'v1',
        schema: { components: [textField('n'), { ...textField('x'), multiple: true }] },
      },
    ];
    const lines = await versionLines(
      schemas,
      [
        { versionId: 'v1', answers: { n: 'one', x: ['a', 'b', 'c'] } },
        { versionId: 'v2', answers: { n: 'two', x: [{ y: 'p' }, { y: 'q' }] } },
      ],
      { layout: backFilled, fields: ['n', 'x.y'] },
    );
    expect(lines).toEqual(['n,x.y', 'one,', 'two,p', 'two,q', '']);
  });

  it.each<[SubmissionExportLayout, string[]]>([
    [backFilled, ['doc,doc.url,doc.name', ',/f/a,a.pdf', '']],
    ['singleRowCSVExport', ['doc.0.url,doc.0.name', '/f/a,a.pdf', '']],
  ])("%s takes a cell's field from its row's version", async (layout, expected) => {
    const grid: FormComponent = {
      type: 'datagrid',
      key: 'doc',
      input: true,
      tree: true,
      components: [textField('name')],
    };
    const schemas = [
      { versionId: 'v2', schema: { components: [grid] } },
      { versionId: 'v1', schema: { components: [{ type: 'file', key: 'doc', input: true }] } },
    ];
    const answers = { doc: [{ name: 'a.pdf', url: '/f/a' }] };
    const lines = await versionLines(schemas, [{ versionId: 'v1', answers }], {
      layout,
      fields: ['doc'],
    });
    expect(lines).toEqual(expected);
  });

  it.each(LAYOUTS)(
    "%s leaves out an older version's button under a newer version's submit field",
    async (layout) => {
      const schemas = [
        { versionId: 'v2', schema: { components: [textField('submit')] } },
        {
          versionId: 'v1',
          schema: { components: [{ type: 'button', key: 'submit', input: true }] },
        },
      ];
      const lines = await versionLines(
        schemas,
        [
          { versionId: 'v1', answers: { submit: true } },
          { versionId: 'v2', answers: { submit: 'yes' } },
        ],
        { layout, fields: ['submit'] },
      );
      expect(lines.map((line) => line.split(',').at(-1))).toEqual(['submit', '', 'yes', '']);
    },
  );

  it.each<[SubmissionExportLayout, string[]]>([
    [backFilled, ['person,person.first', 'Zed,', '']],
    ['singleRowCSVExport', ['person', 'Zed', '']],
  ])(
    '%s writes a row whose version has no schema as any version would',
    async (layout, expected) => {
      const lines = await versionLines(
        personSchemas,
        [{ versionId: 'v0', answers: { person: 'Zed' } }],
        {
          layout,
          fields: ['person', 'person.first'],
        },
      );
      expect(lines).toEqual(expected);
    },
  );
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
          versionId: 'v1',
          schema: {
            components: [
              { type: 'textfield', key: 'constructor', input: true },
              { type: 'textfield', key: 'valueOf', input: true },
            ],
          },
        },
      ],
    });
    expect(lines).toEqual(['constructor,valueOf', 'built,', '']);
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
  it('fails as too large once the CSV rows must pass maxBytes', async () => {
    const written = collect(csvFormat.serialize(each(rows), writeOptions({ maxBytes: 50 })));
    await expect(written).rejects.toThrow(JobFailedError);
    await expect(
      collect(csvFormat.serialize(each(rows), writeOptions({ maxBytes: 50 }))),
    ).rejects.toThrow(EXPORT_TOO_LARGE);
  });

  it('counts only the ticked cells against maxBytes', async () => {
    const lines = await csvLines(
      [{ applicantName: 'Sam', dependants: [{ name: 'x'.repeat(5000) }] }],
      { fields: ['applicantName'], maxBytes: 100 },
    );
    expect(lines).toEqual(['applicantName', 'Sam', '']);
  });

  it('leaves an unanswered field out of the spool, and its cell empty', async () => {
    const layout: SubmissionExportLayout = 'multiRowBackFilledCSVExport';
    const answered = await csvLines([{ applicantName: 'Sam' }], { layout });
    const answeredSpool = spoolSizes.at(-1);
    const blanks = { applicantName: 'Sam', upload: '', home: '', count: '' };
    expect(await csvLines([blanks], { layout })).toEqual(answered);
    expect(spoolSizes.at(-1)).toBe(answeredSpool);
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

describe('staff file links', () => {
  const link = 'https://soba.example/designer/en/build/form-1/submissions/s2/files/f1';
  const linked = () =>
    staffFileLinked(
      each([
        {
          ...rows[1],
          answers: { upload: [{ storage: 'chefs', id: 'f1', url: '/submit/files/f1' }] },
        },
      ]),
      'form-1',
      'https://soba.example/designer',
    );

  it.each<[SubmissionExportLayout, string]>([
    ['multiRowEmptySpacesCSVExport', 'upload.url'],
    ['singleRowCSVExport', 'upload.0.url'],
  ])('write the link in the url column of the %s CSV', async (layout, column) => {
    const text = await collect(csvFormat.serialize(linked(), writeOptions({ layout })));
    const [header, line] = text.slice(1).split('\r\n');

    expect(line.split(',')[header.split(',').indexOf(column)]).toBe(link);
  });

  it('write the link in the JSON', async () => {
    const parsed = JSON.parse(
      await collect(jsonFormat.serialize(linked(), writeOptions({ fields: [], schemas: [] }))),
    );

    expect(parsed[0].upload[0].url).toBe(link);
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
