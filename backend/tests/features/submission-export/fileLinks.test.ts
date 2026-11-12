import {
  staffFileLinked,
  withStaffFileLinks,
} from '../../../src/features/submission-export/fileLinks';
import type { ExportRow } from '../../../src/features/submission-export/source';

const file = (id: string) => ({
  storage: 'chefs',
  id,
  name: `${id}.pdf`,
  url: `/submit/files/${id}`,
});

const row = (answers: Record<string, unknown>): ExportRow => ({
  submissionId: 's1',
  confirmationCode: 'ABC123',
  versionId: 'v1',
  submittedAt: '2026-10-29T17:00:00.000Z',
  submitter: 'starter',
  username: 'starter',
  email: '',
  answers,
});

async function* rowsOf(...rows: ExportRow[]): AsyncIterable<ExportRow> {
  yield* rows;
}

const collect = async (rows: AsyncIterable<ExportRow>): Promise<ExportRow[]> => {
  const all: ExportRow[] = [];
  for await (const item of rows) all.push(item);
  return all;
};

describe('withStaffFileLinks', () => {
  it('links every uploaded file, nested or in an array, and leaves other values as they are', () => {
    const answers = {
      name: 'Orla (sample)',
      upload: [file('f1')],
      grid: [{ proof: [file('f2')], note: { storage: 'other', id: 'x' } }],
    };

    expect(withStaffFileLinks(answers, (id) => `link/${id}`)).toEqual({
      name: 'Orla (sample)',
      upload: [{ ...file('f1'), url: 'link/f1' }],
      grid: [{ proof: [{ ...file('f2'), url: 'link/f2' }], note: { storage: 'other', id: 'x' } }],
    });
  });

  it('keeps the stored url when no link is given', () => {
    expect(withStaffFileLinks({ upload: [file('f1')] }, () => null)).toEqual({
      upload: [file('f1')],
    });
  });
});

describe('staffFileLinked', () => {
  it('links files to the staff download page under DESIGNER_APP_URL, whatever its trailing slash', async () => {
    const link = 'https://soba.example/designer/en/build/form-1/submissions/s1/files/f1';

    for (const base of ['https://soba.example/designer', 'https://soba.example/designer/']) {
      const [linked] = await collect(
        staffFileLinked(rowsOf(row({ upload: [file('f1')] })), 'form-1', base),
      );
      expect(linked.answers).toEqual({ upload: [{ ...file('f1'), url: link }] });
    }
  });
});
