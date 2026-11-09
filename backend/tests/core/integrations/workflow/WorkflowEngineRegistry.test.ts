import {
  checkWorkflowEngineReadiness,
  createWorkflowEngineAdapter,
  getWorkflowEnginePlugins,
  resolveDefaultWorkflowEngineCode,
  resolveWorkflowEnginePlugin,
} from '../../../../src/core/integrations/workflow/WorkflowEngineRegistry';
import { CsWorkflowEngineAdapter } from '../../../../src/plugins/cs-workflow-v1/csWorkflowEngineAdapter';

describe('WorkflowEngineRegistry', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('discovers the connected services and noop engines in its catalog', () => {
    const codes = getWorkflowEnginePlugins().map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['cs-workflow-v1', 'workflow-noop']));
  });

  it('resolves an engine by code and rejects unknown codes', () => {
    expect(resolveWorkflowEnginePlugin('cs-workflow-v1').metadata.version).toBe('v1');
    expect(() => resolveWorkflowEnginePlugin('nope')).toThrow(/No workflow engine plugin/);
  });

  it('creates an adapter for a configured engine', () => {
    process.env.PLUGIN_CS_WORKFLOW_V1_API_BASE_URL = 'http://workflow.test/api/v1';
    process.env.PLUGIN_CS_WORKFLOW_V1_API_KEY = 'test';
    expect(createWorkflowEngineAdapter('cs-workflow-v1')).toBeInstanceOf(CsWorkflowEngineAdapter);
  });

  it('defaults the engine to workflow-noop, honouring the env override', () => {
    delete process.env.WORKFLOW_ENGINE_DEFAULT_CODE;
    expect(resolveDefaultWorkflowEngineCode()).toBe('workflow-noop');

    process.env.WORKFLOW_ENGINE_DEFAULT_CODE = 'cs-workflow-v1';
    expect(resolveDefaultWorkflowEngineCode()).toBe('cs-workflow-v1');
  });

  it('reports readiness per engine, failing those missing config', async () => {
    delete process.env.PLUGIN_CS_WORKFLOW_V1_API_BASE_URL;

    const readiness = await checkWorkflowEngineReadiness();

    expect(readiness['workflow-noop']).toEqual({ ok: true });
    expect(readiness['cs-workflow-v1']).toEqual({
      ok: false,
      message: 'PLUGIN_CS_WORKFLOW_V1_API_BASE_URL is required',
    });
  });
});
