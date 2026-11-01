import {
  FormioEngineAdapter,
  buildSubmissionBody,
} from '../../../src/plugins/formio-v5/formioEngineAdapter';
import type { PluginConfigReader } from '../../../src/core/config/pluginConfig';
import {
  FormioApiError,
  getAuthenticatedFormioClient,
} from '../../../src/plugins/formio-v5/formioV5Client';
import { InternalError, ValidationError } from '../../../src/core/errors';

jest.mock('../../../src/plugins/formio-v5/formioV5Client', () => ({
  ...jest.requireActual('../../../src/plugins/formio-v5/formioV5Client'),
  getAuthenticatedFormioClient: jest.fn(),
}));

const mockedGetClient = getAuthenticatedFormioClient as unknown as jest.Mock;

function makeConfig(): PluginConfigReader {
  return {
    getRequired: (key: string) => `val-${key}`,
    getOptional: () => undefined,
  } as unknown as PluginConfigReader;
}

interface FakeClient {
  loadForm: jest.Mock;
  loadSubmissions: jest.Mock;
  loadSubmission: jest.Mock;
  saveSubmission: jest.Mock;
  deleteSubmission: jest.Mock;
}

function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    loadForm: jest.fn().mockResolvedValue({ _id: 'form-ref-1', components: [] }),
    loadSubmissions: jest.fn().mockResolvedValue([]),
    loadSubmission: jest.fn().mockResolvedValue({ _id: 'sub-1', data: { a: 1 } }),
    saveSubmission: jest.fn().mockResolvedValue({ _id: 'sub-new' }),
    deleteSubmission: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const createInput = {
  engineFormRef: 'form-ref-1',
  submissionId: 's1',
  revisionId: 'rev-3',
  workspaceId: 'ws1',
  data: { firstName: 'Ada' },
  validate: true,
};

describe('FormioEngineAdapter submission methods', () => {
  beforeEach(() => jest.clearAllMocks());

  it('buildSubmissionBody keeps answers clean in data and puts the correlation key in metadata', () => {
    const body = buildSubmissionBody(createInput);
    // Form.io strips non-component data keys, so the correlation key must NOT be in data.
    expect(body.data).toEqual({ firstName: 'Ada' });
    expect(body.metadata).toEqual({
      soba_workspace_id: 'ws1',
      soba_submission_id: 's1',
      soba_revision_id: 'rev-3',
    });
  });

  it('buildSubmissionBody does not mutate the input data', () => {
    const data = { firstName: 'Ada' };
    buildSubmissionBody({ ...createInput, data });
    expect(data).toEqual({ firstName: 'Ada' });
  });

  it('creates a new submission document and returns its engine ref', async () => {
    const client = makeClient({
      loadSubmissions: jest.fn().mockResolvedValue([]),
      saveSubmission: jest.fn().mockResolvedValue({ _id: 'sub-new' }),
    });
    mockedGetClient.mockResolvedValue(client);

    const adapter = new FormioEngineAdapter(makeConfig());
    const res = await adapter.createSubmission(createInput);

    expect(res).toEqual({ engineRef: 'sub-new' });
    expect(client.loadSubmissions).toHaveBeenCalledWith('form-ref-1', {
      params: { 'metadata.soba_revision_id': 'rev-3' },
    });
    const body = client.saveSubmission.mock.calls[0][1] as Record<string, unknown>;
    expect(body._id).toBeUndefined(); // POST (new doc), not PUT
  });

  it.each([
    [true, undefined],
    [false, { params: { noValidate: true } }],
  ])('with validate %s saves with query %j', async (validate, query) => {
    const client = makeClient();
    mockedGetClient.mockResolvedValue(client);

    await new FormioEngineAdapter(makeConfig()).createSubmission({ ...createInput, validate });

    expect(client.saveSubmission).toHaveBeenCalledWith('form-ref-1', expect.any(Object), query);
  });

  it('is idempotent: a retry for the same revision returns the existing doc without re-saving', async () => {
    const client = makeClient({
      loadSubmissions: jest.fn().mockResolvedValue([{ _id: 'sub-existing' }]),
    });
    mockedGetClient.mockResolvedValue(client);

    const adapter = new FormioEngineAdapter(makeConfig());
    const res = await adapter.createSubmission(createInput);

    expect(res).toEqual({ engineRef: 'sub-existing' });
    expect(client.saveSubmission).not.toHaveBeenCalled();
  });

  it('maps a Form.io 4xx rejection to a coded ValidationError about the data', async () => {
    const rejected = Object.assign(new Error('invalid submission'), { status: 400 });
    const client = makeClient({ saveSubmission: jest.fn().mockRejectedValue(rejected) });
    mockedGetClient.mockResolvedValue(client);

    const adapter = new FormioEngineAdapter(makeConfig());
    const created = adapter.createSubmission(createInput);
    await expect(created).rejects.toBeInstanceOf(ValidationError);
    await expect(created).rejects.toMatchObject({
      code: 'engine_data_rejected',
      message: 'Form engine rejected the submission data: invalid submission',
    });
  });

  it('throws when no admin client is available', async () => {
    mockedGetClient.mockResolvedValue(null);
    const adapter = new FormioEngineAdapter(makeConfig());
    await expect(adapter.createSubmission(createInput)).rejects.toThrow(/admin client/i);
  });

  it('readSubmission strips engine-managed fields and the SOBA metadata', async () => {
    const client = makeClient({
      loadSubmission: jest.fn().mockResolvedValue({
        _id: 'sub-1',
        owner: 'o',
        created: 'c',
        data: { firstName: 'Ada' },
        metadata: { soba_revision_id: 'rev-3', headers: { host: 'x' } },
      }),
    });
    mockedGetClient.mockResolvedValue(client);

    const adapter = new FormioEngineAdapter(makeConfig());
    const result = await adapter.readSubmission('form-ref-1', 'sub-1');

    expect(client.loadSubmission).toHaveBeenCalledWith('form-ref-1', 'sub-1');
    expect(result).toEqual({ data: { firstName: 'Ada' } });
  });

  it('readSubmission returns null when the document is not found', async () => {
    const client = makeClient({ loadSubmission: jest.fn().mockResolvedValue(null) });
    mockedGetClient.mockResolvedValue(client);
    const adapter = new FormioEngineAdapter(makeConfig());
    expect(await adapter.readSubmission('form-ref-1', 'missing')).toBeNull();
  });

  const resourceNotFound = () =>
    new FormioApiError(400, 'Error: Resource not found', 'http://formio.test/form/x');

  it.each([
    ['400 Resource not found', resourceNotFound()],
    ['404', new FormioApiError(404, 'Not Found', 'http://formio.test/form/x')],
  ])(
    'fails a read of a missing document with engine_document_missing on %s',
    async (_label, missing) => {
      const client = makeClient({
        loadForm: jest.fn().mockRejectedValue(missing),
        loadSubmission: jest.fn().mockRejectedValue(missing),
        loadSubmissions: jest.fn().mockRejectedValue(missing),
      });
      mockedGetClient.mockResolvedValue(client);
      const adapter = new FormioEngineAdapter(makeConfig());
      const engineDocumentMissing = { statusCode: 500, code: 'engine_document_missing' };
      await expect(adapter.readSchema('missing')).rejects.toBeInstanceOf(InternalError);
      await expect(adapter.readSchema('missing')).rejects.toMatchObject(engineDocumentMissing);
      await expect(adapter.readSubmission('form-ref-1', 'missing')).rejects.toMatchObject(
        engineDocumentMissing,
      );
      await expect(adapter.readSubmissions('missing', ['sub-1'])).rejects.toMatchObject(
        engineDocumentMissing,
      );
    },
  );

  it.each([
    [
      'a 400 for another reason',
      new FormioApiError(400, 'Error: Invalid id', 'http://formio.test'),
    ],
    ['a 500', new FormioApiError(500, 'boom', 'http://formio.test')],
  ])('still throws a read failure that is %s', async (_label, failure) => {
    const client = makeClient({
      loadForm: jest.fn().mockRejectedValue(failure),
      loadSubmission: jest.fn().mockRejectedValue(failure),
      loadSubmissions: jest.fn().mockRejectedValue(failure),
    });
    mockedGetClient.mockResolvedValue(client);
    const adapter = new FormioEngineAdapter(makeConfig());
    await expect(adapter.readSchema('form-ref-1')).rejects.toBe(failure);
    await expect(adapter.readSubmission('form-ref-1', 'sub-1')).rejects.toBe(failure);
    await expect(adapter.readSubmissions('form-ref-1', ['sub-1'])).rejects.toBe(failure);
  });

  it('deleteSubmission deletes the document under its form', async () => {
    const client = makeClient();
    mockedGetClient.mockResolvedValue(client);

    const adapter = new FormioEngineAdapter(makeConfig());
    await adapter.deleteSubmission('form-ref-1', 'sub-1');

    expect(client.deleteSubmission).toHaveBeenCalledWith('form-ref-1', 'sub-1');
  });

  type IdQuery = { params: { _id__in: string } };

  /** Form.io documents for the requested ids, with engine fields and SOBA metadata to strip. */
  const docsFor = (query: IdQuery) =>
    query.params._id__in.split(',').map((id) => ({
      _id: id,
      owner: 'o1',
      created: 'c',
      metadata: { soba_submission_id: 's' },
      data: { a: id },
    }));

  /** A loadSubmissions that returns every requested document. */
  const loadDocs = (_form: string, query: IdQuery) => Promise.resolve(docsFor(query));

  const refsOf = (count: number) => Array.from({ length: count }, (_, i) => `sub-${i}`);

  /** The query readSubmissions sends for one batch of refs. */
  const queryFor = (refs: string[]) => ({
    params: { _id__in: refs.join(','), limit: refs.length },
  });

  const readSubmissions = (refs: string[], signal?: AbortSignal, full?: boolean) =>
    new FormioEngineAdapter(makeConfig()).readSubmissions('form-ref-1', refs, signal, { full });

  it('readSubmissions reads one batch by _id__in and strips each document', async () => {
    const refs = refsOf(3);
    const client = makeClient({ loadSubmissions: jest.fn(loadDocs) });
    mockedGetClient.mockResolvedValue(client);

    const { found, missing } = await readSubmissions(refs);

    expect(client.loadSubmissions.mock.calls).toEqual([
      ['form-ref-1', { params: { _id__in: 'sub-0,sub-1,sub-2', limit: 3 } }],
    ]);
    expect([...found.keys()]).toEqual(refs);
    expect(found.get('sub-1')).toEqual({ data: { a: 'sub-1' } });
    expect(missing).toEqual([]);
  });

  it('readSubmissions asks Form.io for whole documents only when told to', async () => {
    const client = makeClient({ loadSubmissions: jest.fn(loadDocs) });
    mockedGetClient.mockResolvedValue(client);

    await readSubmissions(refsOf(1), undefined, true);

    expect(client.loadSubmissions.mock.calls).toEqual([
      ['form-ref-1', { params: { _id__in: 'sub-0', limit: 1, full: true } }],
    ]);
  });

  it('readSubmissions splits 250 refs into batches of 100, 100 and 50', async () => {
    const refs = refsOf(250);
    const client = makeClient({ loadSubmissions: jest.fn(loadDocs) });
    mockedGetClient.mockResolvedValue(client);

    const { found } = await readSubmissions(refs);

    expect(client.loadSubmissions.mock.calls).toEqual([
      ['form-ref-1', queryFor(refs.slice(0, 100))],
      ['form-ref-1', queryFor(refs.slice(100, 200))],
      ['form-ref-1', queryFor(refs.slice(200))],
    ]);
    expect(found.size).toBe(250);
  });

  it("readSubmissions gives every batch the caller's signal", async () => {
    const client = makeClient({ loadSubmissions: jest.fn(loadDocs) });
    mockedGetClient.mockResolvedValue(client);
    const signal = new AbortController().signal;

    await readSubmissions(refsOf(150), signal);

    expect(client.loadSubmissions).toHaveBeenCalledTimes(2);
    expect(client.loadSubmissions.mock.calls[0][2]).toBe(signal);
    expect(client.loadSubmissions.mock.calls[1][2]).toBe(signal);
  });

  it('readSubmissions starts the next batch only after the previous one resolves', async () => {
    const firstBatch = Promise.withResolvers<void>();
    const client = makeClient({
      loadSubmissions: jest
        .fn(loadDocs)
        .mockImplementationOnce((form, query) =>
          firstBatch.promise.then(() => loadDocs(form, query)),
        ),
    });
    mockedGetClient.mockResolvedValue(client);

    const read = readSubmissions(refsOf(150));
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.loadSubmissions).toHaveBeenCalledTimes(1);

    firstBatch.resolve();
    const { found } = await read;
    expect(client.loadSubmissions).toHaveBeenCalledTimes(2);
    expect(found.size).toBe(150);
  });

  it('readSubmissions lists the refs Form.io did not return as missing', async () => {
    const withoutSub1 = (_form: string, query: IdQuery) =>
      Promise.resolve(docsFor(query).filter((doc) => doc._id !== 'sub-1'));
    mockedGetClient.mockResolvedValue(makeClient({ loadSubmissions: jest.fn(withoutSub1) }));

    const { found, missing } = await readSubmissions(refsOf(3));

    expect([...found.keys()]).toEqual(['sub-0', 'sub-2']);
    expect(missing).toEqual(['sub-1']);
  });

  it('readSubmissions makes no request for no refs', async () => {
    expect(await readSubmissions([])).toEqual({ found: new Map(), missing: [] });
    expect(mockedGetClient).not.toHaveBeenCalled();
  });

  it('readSubmissions stops at a failed batch and rejects with its error', async () => {
    const failure = new FormioApiError(500, 'boom', 'http://formio.test');
    const client = makeClient({
      loadSubmissions: jest
        .fn(loadDocs)
        .mockImplementationOnce(loadDocs)
        .mockRejectedValueOnce(failure),
    });
    mockedGetClient.mockResolvedValue(client);

    await expect(readSubmissions(refsOf(250))).rejects.toBe(failure);
    expect(client.loadSubmissions).toHaveBeenCalledTimes(2);
  });

  it('readSubmissions throws when no admin client is available', async () => {
    mockedGetClient.mockResolvedValue(null);
    await expect(readSubmissions(refsOf(1))).rejects.toThrow(/admin client/i);
  });

  it('deleteSubmission throws when no admin client is available', async () => {
    mockedGetClient.mockResolvedValue(null);
    const adapter = new FormioEngineAdapter(makeConfig());
    await expect(adapter.deleteSubmission('form-ref-1', 'sub-1')).rejects.toThrow(/admin client/i);
  });
});
