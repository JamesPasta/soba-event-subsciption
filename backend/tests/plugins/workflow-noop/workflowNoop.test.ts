import { workflowEnginePluginDefinition } from '../../../src/plugins/workflow-noop';
import { createPluginConfigReader } from '../../../src/core/config/pluginConfig';

describe('workflow-noop', () => {
  const adapter = workflowEnginePluginDefinition.createAdapter(
    createPluginConfigReader(workflowEnginePluginDefinition.code),
  );

  it('has the expected code', () => {
    expect(workflowEnginePluginDefinition.code).toBe('workflow-noop');
  });

  it('has no readiness check', () => {
    expect(adapter.readinessCheck).toBeDefined();
  });
});
