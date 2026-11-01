import { csvFormat, jsonFormat } from '../../../src/features/submission-export/formats';
import { exportFileName } from '../../../src/features/submission-export/job';
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
});

describe('csvFormat formula guard', () => {
  it.each(['=HYPERLINK("http://x")', '+1', '-2', '@SUM(A1)', '\tx'])(
    'writes %j so a spreadsheet reads it as text',
    async (value) => {
      const text = await collect(
        csvFormat.serialize(each([{ ...rows[1], answers: { note: value } }]), {
          fields: ['note'],
          schemas: [],
        }),
      );
      const cell = text.split('\r\n')[1];
      expect(cell.replace(/^"|"$/g, '').startsWith(`'`)).toBe(true);
    },
  );
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
