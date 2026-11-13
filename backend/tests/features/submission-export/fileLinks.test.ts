import {
  staffFileLinked,
  staffLinkedRows,
  withStaffFileLinks,
} from '../../../src/features/submission-export/fileLinks';
import type { ExportRow } from '../../../src/features/submission-export/source';

const F1 = '01a1d585-48e9-712a-9d0a-e9e281cb6a22';
const F2 = '01a1d585-0b25-7418-af3c-6b75082576f2';

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
      upload: [file(F1)],
      grid: [{ proof: [file(F2)], note: { storage: 'other', id: 'x' } }],
    };

    expect(withStaffFileLinks(answers, (id) => `link/${id}`)).toEqual({
      name: 'Orla (sample)',
      upload: [{ ...file(F1), url: `link/${F1}` }],
      grid: [{ proof: [{ ...file(F2), url: `link/${F2}` }], note: { storage: 'other', id: 'x' } }],
    });
  });

  it('leaves answers that only look like a file, and still links the files under them', () => {
    const answers = {
      storage: 'chefs',
      id: 'typed by the submitter',
      url: 'mine',
      upload: [file(F1)],
    };

    expect(withStaffFileLinks(answers, (id) => `link/${id}`)).toEqual({
      ...answers,
      upload: [{ ...file(F1), url: `link/${F1}` }],
    });
  });

  it('links the files under an answer that matches a file', () => {
    const answers = { storage: 'chefs', id: F2, url: 'mine', upload: [file(F1)] };

    expect(withStaffFileLinks(answers, (id) => `link/${id}`)).toEqual({
      storage: 'chefs',
      id: F2,
      url: `link/${F2}`,
      upload: [{ ...file(F1), url: `link/${F1}` }],
    });
  });

  it('keeps the stored url when no link is given', () => {
    expect(withStaffFileLinks({ upload: [file(F1)] }, () => null)).toEqual({
      upload: [file(F1)],
    });
  });
});

describe('staffLinkedRows', () => {
  const stored = row({ upload: [file(F1)] });

  it.each([undefined, ''])(
    'keeps the stored rows and warns once when DESIGNER_APP_URL is %j',
    async (designerUrl) => {
      const log = { warn: jest.fn() };
      const rows = rowsOf(stored);

      const linked = staffLinkedRows(rows, 'form-1', designerUrl, log);

      expect(linked).toBe(rows);
      expect(await collect(linked)).toEqual([stored]);
      expect(log.warn).toHaveBeenCalledTimes(1);
    },
  );

  it('links the rows without a warning when DESIGNER_APP_URL is set', async () => {
    const log = { warn: jest.fn() };

    const [linked] = await collect(
      staffLinkedRows(rowsOf(stored), 'form-1', 'https://soba.example/designer', log),
    );

    expect(linked.answers).toEqual({
      upload: [
        {
          ...file(F1),
          url: `https://soba.example/designer/en/build/form-1/submissions/s1/files/${F1}`,
        },
      ],
    });
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('staffFileLinked', () => {
  it('links files to the staff download page under DESIGNER_APP_URL, whatever its trailing slash', async () => {
    const link = `https://soba.example/designer/en/build/form-1/submissions/s1/files/${F1}`;

    for (const base of ['https://soba.example/designer', 'https://soba.example/designer/']) {
      const [linked] = await collect(
        staffFileLinked(rowsOf(row({ upload: [file(F1)] })), 'form-1', base),
      );
      expect(linked.answers).toEqual({ upload: [{ ...file(F1), url: link }] });
    }
  });
});
