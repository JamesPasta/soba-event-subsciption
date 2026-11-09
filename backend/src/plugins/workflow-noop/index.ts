import type { PluginConfigReader } from '../../core/config/pluginConfig';
import type { WorkflowEngineAdapter } from '../../core/integrations/workflow/WorkflowEngineAdapter';
import type { WorkflowEnginePluginDefinition } from '../../core/integrations/workflow/WorkflowEnginePluginDefinition';

const CODE = 'workflow-noop';

/** No-op workflow engine: starts nothing and knows no instances, no external call. */
function createNoopWorkflowEngineAdapter(config: PluginConfigReader): WorkflowEngineAdapter {
  return {
    readinessCheck: () => Promise.resolve({ ok: !!config }),
    getWorkflows: () => Promise.resolve({ workflows: [] }),
    getWorkflow: (name: string) => Promise.resolve({ id: name, name }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    startWorkflow: (name: string, payload: unknown) => Promise.resolve(true),
  };
}

export const workflowEnginePluginDefinition: WorkflowEnginePluginDefinition = {
  code: CODE,
  metadata: {
    code: CODE,
    name: 'No-op workflow engine',
  },
  createAdapter: createNoopWorkflowEngineAdapter,
};
