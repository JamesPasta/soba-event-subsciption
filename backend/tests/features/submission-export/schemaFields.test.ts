import {
  addressFields,
  exportFieldNames,
  flattenComponents,
  type FormComponent,
} from '../../../src/features/submission-export/schemaFields';

const components: FormComponent[] = [
  { type: 'content', key: 'intro' },
  {
    type: 'panel',
    key: 'page1',
    components: [{ type: 'textfield', key: 'name', input: true }],
  },
  {
    type: 'columns',
    key: 'cols',
    columns: [
      { components: [{ type: 'number', key: 'age', input: true }] },
      { components: [{ type: 'email', key: 'email', input: true }] },
    ],
  },
  {
    type: 'table',
    key: 'tbl',
    rows: [[{ components: [{ type: 'textfield', key: 'cell', input: true }] }]],
  },
  {
    type: 'datagrid',
    key: 'people',
    input: true,
    components: [
      { type: 'textfield', key: 'first', input: true },
      { type: 'textfield', key: 'last', input: true },
    ],
  },
  {
    type: 'selectboxes',
    key: 'colours',
    input: true,
    values: [{ value: 'red' }, { value: 'blue' }],
  },
  {
    type: 'survey',
    key: 'rating',
    input: true,
    questions: [{ value: 'speed' }, { value: 'price' }],
  },
  {
    type: 'form',
    key: 'nested',
    input: true,
    components: [{ type: 'textfield', key: 'inner', input: true }],
  },
  { type: 'bcgov-file', key: 'upload', input: true },
  { type: 'button', key: 'submit', input: true },
];

const ADDRESS: FormComponent = {
  type: 'address',
  key: 'addr',
  input: true,
  tree: true,
  components: [{ type: 'textfield', key: 'city', input: true }],
};

describe('flattenComponents', () => {
  it('lists answer columns in form order, skipping layout and buttons', () => {
    expect(flattenComponents(components)).toEqual([
      'name',
      'age',
      'email',
      'cell',
      'people',
      'people.first',
      'people.last',
      'colours.red',
      'colours.blue',
      'rating.speed',
      'rating.price',
      'nested',
      'nested.data.inner',
      'upload',
    ]);
  });

  it('prefixes a sub-value component inside a grid with the grid key', () => {
    expect(
      flattenComponents([
        {
          type: 'datagrid',
          key: 'grid',
          input: true,
          components: [{ type: 'selectboxes', key: 'pick', input: true, values: [{ value: 'a' }] }],
        },
      ]),
    ).toEqual(['grid', 'grid.pick.a']);
  });

  it('lists a manual address, then its parts under the address key', () => {
    expect(flattenComponents([{ ...ADDRESS, enableManualMode: true }])).toEqual([
      'addr',
      'addr.address.city',
    ]);
  });

  it.each([
    ['without manual mode', {}],
    ['with multiple values', { enableManualMode: true, multiple: true }],
  ])('lists only the whole address %s', (_name, settings) => {
    expect(flattenComponents([{ ...ADDRESS, ...settings }])).toEqual(['addr']);
  });

  it('lists only the options that name an answer key, else the whole answer', () => {
    expect(
      flattenComponents([
        {
          type: 'selectboxes',
          key: 'fromUrl',
          input: true,
          dataSrc: 'url',
          values: [{ value: '' }],
        },
        { type: 'selectboxes', key: 'unnamed', input: true, values: [{ value: '' }] },
        {
          type: 'selectboxes',
          key: 'partly',
          input: true,
          dataSrc: 'values',
          values: [{ value: 'a' }, { value: '' }],
        },
      ]),
    ).toEqual(['fromUrl', 'unnamed', 'partly.a']);
  });

  it('answers nothing for a missing schema', () => {
    expect(flattenComponents(undefined)).toEqual([]);
  });
});

describe('exportFieldNames', () => {
  const SUBMISSION = [
    'form.confirmationId',
    'form.submissionId',
    'form.formVersionId',
    'form.submittedAt',
    'form.submitter',
    'form.username',
    'form.email',
  ];

  it("lists the submission's fields, then the newest schema's, then fields only older ones have", () => {
    const newest = { components: [{ type: 'textfield', key: 'name', input: true }] };
    const older = {
      components: [
        { type: 'textfield', key: 'phone', input: true },
        { type: 'textfield', key: 'name', input: true },
      ],
    };

    expect(
      exportFieldNames([
        { versionId: 'v2', schema: newest },
        { versionId: 'v1', schema: older },
      ]),
    ).toEqual([...SUBMISSION, 'name', 'phone']);
  });

  it("lists only the submission's fields without a schema, or one with no components", () => {
    expect(exportFieldNames([])).toEqual(SUBMISSION);
    expect(exportFieldNames([{ versionId: 'v1', schema: { display: 'form' } }])).toEqual(
      SUBMISSION,
    );
  });
});

describe('addressFields', () => {
  it("lists the schema's address components, nested ones under their grid", () => {
    const schema = {
      components: [
        { type: 'address', key: 'home', input: true },
        {
          type: 'datagrid',
          key: 'grid',
          input: true,
          tree: true,
          components: [{ type: 'address', key: 'where', input: true }],
        },
        { type: 'datagrid', key: 'mailingAddresses', input: true, tree: true, components: [] },
      ],
    };

    expect(addressFields(schema)).toEqual(['home', 'grid.where']);
  });
});
