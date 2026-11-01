import { csvFormat, jsonFormat } from '../../../src/features/submission-export/formats';
import { exportFileName } from '../../../src/features/submission-export/job';
import { flattenComponents } from '../../../src/features/submission-export/schemaFields';
import type { ExportRow } from '../../../src/features/submission-export/source';

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
      notes: 'line one\nline two',
      dependants: [
        { name: 'Casey', age: 12 },
        { name: 'Riley', age: 4 },
      ],
      address: { city: 'Victoria' },
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

async function* each<T>(items: T[]): AsyncIterable<T> {
  yield* items;
}

const collect = async (text: AsyncIterable<string>): Promise<string> => {
  let all = '';
  for await (const chunk of text) all += chunk;
  return all;
};

describe('csvFormat (placeholder)', () => {
  it('writes the fields as a header and one quoted line per submission', async () => {
    const text = await collect(
      csvFormat.serialize(each(rows), {
        fields: [
          'form.confirmationId',
          'form.submitter',
          'form.username',
          'form.email',
          'applicantName',
          'notes',
          'dependants.name',
          'address',
          'missing',
        ],
        schemas: [],
      }),
    );
    expect(text).toBe(
      [
        'form.confirmationId,form.submitter,form.username,form.email,applicantName,notes,dependants.name,address,missing',
        'AB12CD34,Sam,sam.sample,sam.sample@example.com,"Morgan ""Mo"", Test","line one\nline two",Casey; Riley,"{""city"":""Victoria""}",',
        'EF56GH78,public,,,,,,,',
        '',
      ].join('\r\n'),
    );
  });

  it('finds an answer whose option value holds dots', async () => {
    const answers = { pick: { '1': true, '1.5': false } };
    const text = await collect(
      csvFormat.serialize(each([{ ...rows[1], answers }]), {
        fields: ['pick.1', 'pick.1.5'],
        schemas: [],
      }),
    );
    expect(text.split('\r\n')[1]).toBe('true,false');
  });

  it('finds the parts of a manual address under its address key', async () => {
    const answers = {
      addr: { mode: 'manual', address: { address1: '1 Main St', city: 'Victoria' } },
    };
    const text = await collect(
      csvFormat.serialize(each([{ ...rows[1], answers }]), {
        fields: flattenComponents([
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
        ]).slice(1),
        schemas: [],
      }),
    );

    expect(text.split('\r\n')[1]).toBe('1 Main St,Victoria');
  });

  it('reads a field named like an inherited property as an answer', async () => {
    const answers = { constructor: 'built' };
    const text = await collect(
      csvFormat.serialize(each([{ ...rows[1], answers }]), {
        fields: ['constructor', 'valueOf', '__proto__'],
        schemas: [],
      }),
    );
    expect(text.split('\r\n')[1]).toBe('built,,');
  });
});

describe('csvFormat formula guard', () => {
  const cellOf = async (answer: unknown, field = 'note'): Promise<string> => {
    const text = await collect(
      csvFormat.serialize(each([{ ...rows[1], answers: { note: answer } }]), {
        fields: [field],
        schemas: [],
      }),
    );
    return text.split('\r\n')[1];
  };

  it.each(['=HYPERLINK("http://x")', '+1', '-2', '@SUM(A1)', '\tx'])(
    'writes %j so a spreadsheet reads it as text',
    async (value) => {
      const cell = await cellOf(value);
      expect(cell.replace(/^"|"$/g, '').startsWith(`'`)).toBe(true);
    },
  );

  it('leaves a number answer as a number', async () => {
    expect(await cellOf(-5)).toBe('-5');
  });

  it('leaves a grid of number answers as numbers', async () => {
    expect(await cellOf([{ years: -1 }, { years: 2 }], 'note.years')).toBe('-1; 2');
  });

  it('guards a grid cell when any of its answers is text', async () => {
    expect(await cellOf([{ years: -1 }, { years: '=2' }], 'note.years')).toBe(`'-1; =2`);
  });
});

describe('jsonFormat', () => {
  it("keeps the submission's facts when an answer is named form", async () => {
    const parsed = JSON.parse(
      await collect(
        jsonFormat.serialize(each([{ ...rows[1], answers: { form: 'mine', other: 1 } }]), {
          fields: [],
          schemas: [],
        }),
      ),
    );
    expect(parsed[0].form.confirmationId).toBe('EF56GH78');
    expect(parsed[0].other).toBe(1);
  });

  it('writes an array of submissions with their facts under form', async () => {
    const parsed = JSON.parse(
      await collect(jsonFormat.serialize(each(rows), { fields: [], schemas: [] })),
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
      JSON.parse(await collect(jsonFormat.serialize(each([]), { fields: [], schemas: [] }))),
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
