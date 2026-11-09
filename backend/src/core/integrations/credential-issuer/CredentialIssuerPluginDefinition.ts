import type { PluginConfigReader } from '../../config/pluginConfig';
import type { CredentialIssuerAdapter } from './CredentialIssuerAdapter';

export interface CredentialIssuerPluginDefinition {
  code: string;
  metadata: { code: string; name: string; version?: string };
  createAdapter: (config: PluginConfigReader) => CredentialIssuerAdapter;
}
