import type { PluginConfigReader } from '../../config/pluginConfig';
import type { UserSearchAdapter } from './UserSearchAdapter';

export interface UserSearchMetadata {
  code: string;
  name: string;
  version?: string;
}

export interface UserSearchPluginDefinition {
  code: string;
  metadata: UserSearchMetadata;
  createAdapter: (config: PluginConfigReader) => UserSearchAdapter;
}
