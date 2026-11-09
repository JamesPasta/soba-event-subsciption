import type { PluginConfigReader } from '../../core/config/pluginConfig';
import type { WorkflowEnginePluginDefinition } from '../../core/integrations/workflow/WorkflowEnginePluginDefinition';
import { CsWorkflowEngineAdapter } from './csWorkflowEngineAdapter';

const CODE = 'cs-workflow-v1';

export const workflowEnginePluginDefinition: WorkflowEnginePluginDefinition = {
  code: CODE,
  metadata: {
    code: CODE,
    name: 'Connected Services Workflow',
    version: 'v1',
  },
  createAdapter: (config: PluginConfigReader) => new CsWorkflowEngineAdapter(config),
};
