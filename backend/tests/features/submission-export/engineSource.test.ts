import type {
  FormEngineAdapter,
  ReadSubmissionsResult,
} from '../../../src/core/integrations/form-engine/FormEngineAdapter';
import { JobFailedError } from '../../../src/core/jobs/settlement';
import {
  bulkAnswerReader,
  engineExportSource,
  type ReadAnswers,
  type SubmissionQuery,
  type SubmissionRecord,
} from '../../../src/features/submission-export/engineSource';
import type { ExportBounds, ExportRow } from '../../../src/features/submission-export/source';

const bounds: ExportBounds = { workspaceId: 'ws1', formId: 'form-1', to: new Date() };

const record = (
  id: string,
  engineSchemaRef: string | null,
  engineSubmissionRef: string | null = `doc-${id}`,
): SubmissionRecord => ({
  submissionId: id,
  confirmationCode: `CODE-${id}`,
  versionId: `version-of-${engineSchemaRef}`,
  submittedAt: '2026-10-01T16:05:00.000Z',
  submitter: 'Sam',
  username: 'sam.sample',
  email: 'sam.sample@example.com',
  engineSchemaRef,
  engineSubmissionRef,
});

const queryOf = (pages: SubmissionRecord[][]): SubmissionQuery => ({
  count: () => Promise.resolve(pages.flat().length),
  async *pages() {
    yield* pages;
  },
});

/** An engine that holds every document except `absent`, and records each read. */
const engine = (absent: string[] = []) => {
  const calls: { formRef: string; refs: string[] }[] = [];
  const read: ReadAnswers = (formRef, refs) => {
    calls.push({ formRef, refs });
    const found = new Map(
      refs
        .filter((ref) => !absent.includes(ref))
        .map((ref): [string, Record<string, unknown>] => [
          ref,
          { form: formRef, state: 'submitted', data: { ref } },
        ]),
    );
    return Promise.resolve({ found, missing: refs.filter((ref) => !found.has(ref)) });
  };
  return { calls, read };
};

const run = async (
  source: ReturnType<typeof engineExportSource>,
  signal = new AbortController().signal,
) => {
  const rows: ExportRow[] = [];
  const unread: number[] = [];
  const options = { pageSize: 100, signal, onUnread: (count: number) => unread.push(count) };
  for await (const row of source.rows(bounds, options)) rows.push(row);
  return { rows, unread };
};

describe('engineExportSource', () => {
  it('reads each engine form of a page once and keeps the query order', async () => {
    const { calls, read } = engine();
    const page = [record('a', 'v1'), record('b', 'v2'), record('c', 'v1')];

    const { rows, unread } = await run(engineExportSource(queryOf([page]), read));

    expect(calls).toEqual([
      { formRef: 'v1', refs: ['doc-a', 'doc-c'] },
      { formRef: 'v2', refs: ['doc-b'] },
    ]);
    expect(rows.map((row) => row.submissionId)).toEqual(['a', 'b', 'c']);
    expect(unread).toEqual([]);
  });

  it('writes the answers under the document data and the submission facts from the query', async () => {
    const { rows } = await run(engineExportSource(queryOf([[record('a', 'v1')]]), engine().read));

    expect(rows).toEqual([
      {
        submissionId: 'a',
        confirmationCode: 'CODE-a',
        versionId: 'version-of-v1',
        submittedAt: '2026-10-01T16:05:00.000Z',
        submitter: 'Sam',
        username: 'sam.sample',
        email: 'sam.sample@example.com',
        answers: { ref: 'doc-a' },
      },
    ]);
  });

  it('counts submissions without a document per page and leaves them out', async () => {
    const { calls, read } = engine(['doc-b']);
    const pages = [
      [record('a', 'v1'), record('b', 'v1'), record('c', 'v1', null)],
      [record('d', null), record('e', 'v1')],
    ];

    const { rows, unread } = await run(engineExportSource(queryOf(pages), read));

    expect(rows.map((row) => row.submissionId)).toEqual(['a', 'e']);
    expect(unread).toEqual([2, 1]);
    expect(calls).toEqual([
      { formRef: 'v1', refs: ['doc-a', 'doc-b'] },
      { formRef: 'v1', refs: ['doc-e'] },
    ]);
  });

  it('passes the signal to the engine and stops at the next page once aborted', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const read: ReadAnswers = (formRef, refs, signal) => {
      signals.push(signal);
      controller.abort('cancel');
      return engine().read(formRef, refs, signal);
    };
    const pages = [[record('a', 'v1')], [record('b', 'v1')]];

    const rows = run(engineExportSource(queryOf(pages), read), controller.signal);

    await expect(rows).rejects.toBe('cancel');
    expect(signals).toEqual([controller.signal]);
  });

  it('counts with the query', async () => {
    const source = engineExportSource(
      queryOf([[record('a', 'v1'), record('b', 'v1')]]),
      engine().read,
    );

    await expect(source.count(bounds)).resolves.toBe(2);
  });

  it('fails the export when the engine has no bulk read', () => {
    const adapter = {} as FormEngineAdapter;

    expect(() => bulkAnswerReader(adapter)).toThrow(JobFailedError);
  });

  /** An adapter whose bulk read needs its own `this`, and records how it was asked. */
  class Adapter {
    readonly calls: unknown[][] = [];
    private readonly result: ReadSubmissionsResult = { found: new Map(), missing: ['x'] };
    readSubmissions(...args: unknown[]) {
      this.calls.push(args);
      return Promise.resolve(this.result);
    }
  }

  it('reads through the engine adapter itself, without whole documents by default', async () => {
    const adapter = new Adapter();
    const signal = new AbortController().signal;
    const read = bulkAnswerReader(adapter as unknown as FormEngineAdapter);

    await expect(read('v1', ['x'], signal)).resolves.toEqual({ found: new Map(), missing: ['x'] });
    expect(adapter.calls).toEqual([['v1', ['x'], signal, {}]]);
  });

  it('asks for whole documents when told to', async () => {
    const adapter = new Adapter();
    const signal = new AbortController().signal;
    const read = bulkAnswerReader(adapter as unknown as FormEngineAdapter, { full: true });

    await read('v1', ['x'], signal);

    expect(adapter.calls).toEqual([['v1', ['x'], signal, { full: true }]]);
  });
});
