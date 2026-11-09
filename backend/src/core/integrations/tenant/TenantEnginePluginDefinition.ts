import type { PluginConfigReader } from '../../config/pluginConfig';
import type { TenantEngineAdapter } from './TenantEngineAdapter';

export interface TenantEngineMetadata {
  code: string;
  name: string;
  version?: string;
}

export interface TenantEnginePluginDefinition {
  code: string;
  metadata: TenantEngineMetadata;
  createAdapter: (config: PluginConfigReader) => TenantEngineAdapter;
}
