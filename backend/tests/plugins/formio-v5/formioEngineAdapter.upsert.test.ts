import { FormioEngineAdapter } from '../../../src/plugins/formio-v5/formioEngineAdapter';
import type { PluginConfigReader } from '../../../src/core/config/pluginConfig';
import {
  FormioApiError,
  getAuthenticatedFormioClient,
} from '../../../src/plugins/formio-v5/formioV5Client';
import { ValidationError } from '../../../src/core/errors';

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
  loadForms: jest.Mock;
  loadForm: jest.Mock;
  saveForm: jest.Mock;
  deleteForm: jest.Mock;
}

function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    loadForms: jest.fn().mockResolvedValue([]),
    loadForm: jest.fn().mockResolvedValue({ _id: 'ref', name: 'soba-x' }),
    saveForm: jest.fn().mockResolvedValue({ _id: 'new-id' }),
    deleteForm: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('FormioEngineAdapter schema methods', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates (POST) a new document when none exists, with deterministic identity + tenancy metadata', async () => {
    const client = makeClient({
      loadForms: jest.fn().mockResolvedValue([]),
      saveForm: jest.fn().mockResolvedValue({ _id: 'new-id' }),
    });
    mockedGetClient.mockResolvedValue(client);

    const adapter = new FormioEngineAdapter(makeConfig());
    const res = await adapter.upsertSchema({
      formVersionId: 'v1',
      workspaceId: 'ws1',
      schema: { components: [] },
    });

    expect(res).toEqual({ engineRef: 'new-id' });
    expect(client.loadForms).toHaveBeenCalledWith({ params: { name: 'soba-v1' } }, undefined);

    const body = client.saveForm.mock.calls[0][0] as Record<string, unknown>;
    expect(body._id).toBeUndefined(); // POST path, not PUT
    expect(body.name).toBe('soba-v1');
    expect(body.path).toBe('soba-v1');
    expect(body.tags).toEqual(expect.arrayContaining(['soba', 'ws1']));
    const props = body.properties as Record<string, unknown>;
    expect(props.soba_workspace_id).toBe('ws1');
    expect(props.soba_form_version_id).toBe('v1');
  });

  it('updates (PUT) the existing document on retry — idempotent, no duplicate', async () => {
    const client = makeClient({
      loadForms: jest.fn().mockResolvedValue([{ _id: 'abc' }]),
      saveForm: jest.fn().mockResolvedValue({ _id: 'abc' }),
    });
    mockedGetClient.mockResolvedValue(client);

    const adapter = new FormioEngineAdapter(makeConfig());
    const res = await adapter.upsertSchema({ formVersionId: 'v1', workspaceId: 'ws1', schema: {} });

    expect(res).toEqual({ engineRef: 'abc' });
    const body = client.saveForm.mock.calls[0][0] as Record<string, unknown>;
    expect(body._id).toBe('abc'); // PUT path
  });

  // Two writes for the same version both found no document and both posted; the second updates the
  // document the first created instead of failing on its name.
  it('updates the document a concurrent write created when its own create is refused', async () => {
    const client = makeClient({
      loadForms: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ _id: 'abc' }]),
      saveForm: jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('path must be unique'), { status: 400 }))
        .mockResolvedValueOnce({ _id: 'abc' }),
    });
    mockedGetClient.mockResolvedValue(client);

    const adapter = new FormioEngineAdapter(makeConfig());
    const res = await adapter.upsertSchema({ formVersionId: 'v1', workspaceId: 'ws1', schema: {} });

    expect(res).toEqual({ engineRef: 'abc' });
    expect((client.saveForm.mock.calls[1][0] as Record<string, unknown>)._id).toBe('abc');
  });

  // Overlapping creates left other documents with the version's name; Form.io refuses the write
  // while they exist.
  it("deletes other documents with the name before writing the version's own", async () => {
    const client = makeClient({
      loadForms: jest.fn().mockResolvedValue([{ _id: 'other' }, { _id: 'own' }, { _id: 'gone' }]),
      deleteForm: jest
        .fn()
        .mockImplementation((id: string) =>
          id === 'gone'
            ? Promise.reject(new FormioApiError(404, 'Not found', '/form/gone'))
            : Promise.resolve(),
        ),
      saveForm: jest.fn().mockResolvedValue({ _id: 'own' }),
    });
    mockedGetClient.mockResolvedValue(client);
    const signal = new AbortController().signal;

    const adapter = new FormioEngineAdapter(makeConfig());
    const res = await adapter.upsertSchema({
      formVersionId: 'v1',
      workspaceId: 'ws1',
      schema: {},
      engineRef: 'own',
      signal,
    });

    expect(res).toEqual({ engineRef: 'own' });
    expect(client.deleteForm.mock.calls).toEqual([
      ['other', signal],
      ['gone', signal],
    ]);
    expect((client.saveForm.mock.calls[0][0] as Record<string, unknown>)._id).toBe('own');
  });

  // A create has no committed document yet, so it cannot tell which one to keep.
  it("deletes nothing without the version's own document", async () => {
    const client = makeClient({
      loadForms: jest.fn().mockResolvedValue([{ _id: 'first' }, { _id: 'second' }]),
      saveForm: jest.fn().mockResolvedValue({ _id: 'first' }),
    });
    mockedGetClient.mockResolvedValue(client);

    const adapter = new FormioEngineAdapter(makeConfig());
    await adapter.upsertSchema({ formVersionId: 'v1', workspaceId: 'ws1', schema: {} });

    expect(client.deleteForm).not.toHaveBeenCalled();
    expect((client.saveForm.mock.calls[0][0] as Record<string, unknown>)._id).toBe('first');
  });

  it("gives both engine calls the caller's signal", async () => {
    const client = makeClient({ loadForms: jest.fn().mockResolvedValue([{ _id: 'abc' }]) });
    mockedGetClient.mockResolvedValue(client);
    const signal = new AbortController().signal;

    const adapter = new FormioEngineAdapter(makeConfig());
    await adapter.upsertSchema({ formVersionId: 'v1', workspaceId: 'ws1', schema: {}, signal });

    expect(client.loadForms.mock.calls[0][1]).toBe(signal);
    expect(client.saveForm.mock.calls[0][1]).toBe(signal);
    expect(client.saveForm.mock.calls[0][0]).not.toHaveProperty('signal');
  });

  it('throws when no admin client is available', async () => {
    mockedGetClient.mockResolvedValue(null);
    const adapter = new FormioEngineAdapter(makeConfig());
    await expect(
      adapter.upsertSchema({ formVersionId: 'v1', workspaceId: 'ws1', schema: {} }),
    ).rejects.toThrow(/admin client/i);
  });

  it('throws when saveForm returns no _id', async () => {
    const client = makeClient({ saveForm: jest.fn().mockResolvedValue({}) });
    mockedGetClient.mockResolvedValue(client);
    const adapter = new FormioEngineAdapter(makeConfig());
    await expect(
      adapter.upsertSchema({ formVersionId: 'v1', workspaceId: 'ws1', schema: {} }),
    ).rejects.toThrow(/_id/i);
  });

  it('maps a Form.io 4xx rejection to a coded ValidationError', async () => {
    const rejected = Object.assign(new Error('The Path must be unique per Project.'), {
      status: 400,
    });
    const client = makeClient({ saveForm: jest.fn().mockRejectedValue(rejected) });
    mockedGetClient.mockResolvedValue(client);
    const adapter = new FormioEngineAdapter(makeConfig());
    const upsert = adapter.upsertSchema({ formVersionId: 'v1', workspaceId: 'ws1', schema: {} });
    await expect(upsert).rejects.toBeInstanceOf(ValidationError);
    await expect(upsert).rejects.toMatchObject({
      code: 'engine_schema_rejected',
      message: 'Form engine rejected the schema: The Path must be unique per Project.',
    });
  });

  it('re-throws a non-4xx (5xx/network) saveForm rejection unchanged', async () => {
    const client = makeClient({
      saveForm: jest.fn().mockRejectedValue({ status: 503, message: 'upstream down' }),
    });
    mockedGetClient.mockResolvedValue(client);
    const adapter = new FormioEngineAdapter(makeConfig());
    await expect(
      adapter.upsertSchema({ formVersionId: 'v1', workspaceId: 'ws1', schema: {} }),
    ).rejects.not.toBeInstanceOf(ValidationError);
  });

  it('reads the document by ref', async () => {
    const client = makeClient();
    mockedGetClient.mockResolvedValue(client);
    const adapter = new FormioEngineAdapter(makeConfig());
    await adapter.readSchema('ref1');
    expect(client.loadForm).toHaveBeenCalledWith('ref1');
  });

  it('readSchema strips engine-managed fields from the document', async () => {
    const client = makeClient({
      loadForm: jest.fn().mockResolvedValue({
        _id: 'eng-1',
        machineName: 'soba-v1',
        created: 'x',
        modified: 'y',
        owner: 'o',
        project: 'p',
        display: 'form',
        components: [],
      }),
    });
    mockedGetClient.mockResolvedValue(client);
    const adapter = new FormioEngineAdapter(makeConfig());
    const result = await adapter.readSchema('eng-1');
    expect(result).toEqual({ display: 'form', components: [] });
  });

  it('deletes the document by ref', async () => {
    const client = makeClient();
    mockedGetClient.mockResolvedValue(client);
    const adapter = new FormioEngineAdapter(makeConfig());
    await adapter.deleteSchema('ref2');
    expect(client.deleteForm).toHaveBeenCalledWith('ref2');
  });

  it('readSchema throws when no admin client is available', async () => {
    mockedGetClient.mockResolvedValue(null);
    const adapter = new FormioEngineAdapter(makeConfig());
    await expect(adapter.readSchema('ref1')).rejects.toThrow(/admin client/i);
  });

  it('deleteSchema throws when no admin client is available', async () => {
    mockedGetClient.mockResolvedValue(null);
    const adapter = new FormioEngineAdapter(makeConfig());
    await expect(adapter.deleteSchema('ref2')).rejects.toThrow(/admin client/i);
  });
});
