import { workflowEnginePluginDefinition } from '../../../src/plugins/cs-workflow-v1';
import { CsWorkflowEngineAdapter } from '../../../src/plugins/cs-workflow-v1/csWorkflowEngineAdapter';
import {
  createPluginConfigReaderFrom,
  type PluginConfigReader,
} from '../../../src/core/config/pluginConfig';
import { createEnvReader } from '../../../src/core/config/env';

function makeConfig(values: Record<string, string>): PluginConfigReader {
  return createPluginConfigReaderFrom(
    createEnvReader(
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [`PLUGIN_CS_WORKFLOW_V1_${key}`, value]),
      ),
    ),
    'cs-workflow-v1',
  );
}

describe('cs-workflow-v1 plugin', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('declares the expected definition', () => {
    expect(workflowEnginePluginDefinition.code).toBe('cs-workflow-v1');
    expect(workflowEnginePluginDefinition.metadata).toEqual({
      code: 'cs-workflow-v1',
      name: 'Connected Services Workflow',
      version: 'v1',
    });
  });

  it('requires the API base URL', () => {
    expect(() => new CsWorkflowEngineAdapter(makeConfig({}))).toThrow(
      'PLUGIN_CS_WORKFLOW_V1_API_BASE_URL is required',
    );
  });

  it('readinessCheck is ok when health answers with its JSON body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const adapter = new CsWorkflowEngineAdapter(
      makeConfig({ API_BASE_URL: 'http://localhost/api/v1', API_KEY: 'test-key' }),
    );

    await expect(adapter.readinessCheck()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/v1/workflows',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'X-N8N-API-KEY': 'test-key',
        },
      }),
    );
  });

  it('readinessCheck is not ok when the base URL reaches the frontend', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('Not JSON');
      },
    });

    const adapter = new CsWorkflowEngineAdapter(
      makeConfig({ API_BASE_URL: 'http://localhost/api/v1', API_KEY: 'test-key' }),
    );

    await expect(adapter.readinessCheck()).resolves.toEqual({
      ok: false,
      message: 'Unexpected Connected Services Workflow health response',
    });
  });

  it('readinessCheck is not ok when the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const adapter = new CsWorkflowEngineAdapter(
      makeConfig({ API_BASE_URL: 'http://localhost/api/v1', API_KEY: 'test-key' }),
    );

    const result = await adapter.readinessCheck();
    expect(result.ok).toBe(false);
  });

  it('workflows is ok when n8n answers with its JSON body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const adapter = new CsWorkflowEngineAdapter(
      makeConfig({ API_BASE_URL: 'http://localhost/api/v1', API_KEY: 'test-key' }),
    );

    await expect(adapter.getWorkflows({})).resolves.toEqual({ workflows: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/v1/workflows?active=true',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('workflow is ok when n8n answers with its JSON body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: '123', name: 'test' }] }),
    });

    const adapter = new CsWorkflowEngineAdapter(
      makeConfig({ API_BASE_URL: 'http://localhost/api/v1', API_KEY: 'test-key' }),
    );

    await expect(adapter.getWorkflow('test')).resolves.toEqual({ name: 'test', id: '123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost/api/v1/workflows?name=test&active=true',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });
});
