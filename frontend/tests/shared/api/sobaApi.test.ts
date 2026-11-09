import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  addSobaSubmissionNote,
  deleteSobaSubmission,
  getSobaSubmissionReview,
  getSobaSubmissionReviewers,
  selectWorkspace,
  reviseSubmitSubmission,
  updateSobaSubmissionData,
  updateSobaSubmissionStatus,
} from '@/src/shared/api/sobaApi';
import { SubmissionReviewStatuses } from '@/src/types/submissionReview';

function mockResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      id: 'w1',
      name: 'WS',
      kind: 'personal',
      role: 'owner',
      status: 'active',
    }),
  } as unknown as Response;
}

describe('selectWorkspace', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs /workspaces/:id with the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await selectWorkspace('tok', 'w1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/workspaces/w1');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(result.id).toBe('w1');
  });
});

function deleteResponse(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => {
      if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
      return body;
    },
  } as unknown as Response;
}

describe('deleteSobaSubmission', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('DELETEs the design route and resolves on a 204 with no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(deleteResponse(204));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteSobaSubmission('tok', 's1')).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/design/submissions/s1');
    expect(init.method).toBe('DELETE');
  });

  it('treats a 404 as already deleted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(deleteResponse(404, { error: 'Not found' })));

    await expect(deleteSobaSubmission('tok', 's1')).resolves.toBeUndefined();
  });

  it('throws the backend message on a 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(deleteResponse(403, { error: 'Insufficient form permissions' })),
    );

    await expect(deleteSobaSubmission('tok', 's1')).rejects.toThrow(
      'Insufficient form permissions',
    );
  });
});

describe('submission review calls', () => {
  const REVIEW = { allowStatusUpdates: false, statusHistory: [], notes: [], editHistory: [] };
  const reviewResponse = () =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => REVIEW,
    }) as unknown as Response;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue(reviewResponse());
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('reads the review of one submission', async () => {
    const fetchMock = stubFetch();

    const result = await getSobaSubmissionReview('tok', 's1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/design\/submissions\/s1\/review$/);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(result).toEqual(REVIEW);
  });

  it('posts a note with the id the caller chose', async () => {
    const fetchMock = stubFetch();
    const note = { id: '01a1891a-3246-773c-a7ec-39fca5fea6bf', text: 'Needs a second look' };

    await addSobaSubmissionNote('tok', 's1', note);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/design\/submissions\/s1\/review\/notes$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(note);
  });

  it('posts a status change from the status the caller saw', async () => {
    const fetchMock = stubFetch();
    const change = {
      id: '01a1891a-3246-773c-a7ec-39fca5fea6c0',
      fromStatusId: '01a1891a-3246-773c-a7ec-39fca5fea6c1',
      status: SubmissionReviewStatuses.completed,
      assigneeId: null,
    };

    await updateSobaSubmissionStatus('tok', 's1', change);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/design\/submissions\/s1\/review\/status$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(change);
  });

  it('reads who the submission can be assigned to', async () => {
    const fetchMock = stubFetch();

    await getSobaSubmissionReviewers('tok', 's1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/design\/submissions\/s1\/review\/reviewers$/);
    expect(init.method).toBe('GET');
  });

  it('puts staff changes to the answers, with the revision they were based on', async () => {
    const fetchMock = stubFetch();
    const body = { data: { a: 2 }, revisionId: 'r3', baseRevisionId: 'r2' };

    await updateSobaSubmissionData('tok', 's1', body);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/design\/submissions\/s1\/data$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("sends the owner's own submission back to revise under the client's id", async () => {
    const fetchMock = stubFetch();

    await reviseSubmitSubmission('tok', 's1', { id: 'c1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/submit\/submissions\/s1\/revise$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ id: 'c1' });
  });
});
