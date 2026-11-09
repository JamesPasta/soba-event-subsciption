import type { PluginConfigReader } from '../../config/pluginConfig';
import type { WorkflowEngineAdapter } from './WorkflowEngineAdapter';

export interface WorkflowEngineMetadata {
  code: string;
  name: string;
  version?: string;
}

export interface WorkflowEnginePluginDefinition {
  code: string;
  metadata: WorkflowEngineMetadata;
  createAdapter: (config: PluginConfigReader) => WorkflowEngineAdapter;
}
