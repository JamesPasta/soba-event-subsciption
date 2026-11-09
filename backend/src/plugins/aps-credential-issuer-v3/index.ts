import type { CredentialIssuerPluginDefinition } from '../../core/integrations/credential-issuer/CredentialIssuerPluginDefinition';
import { ApsCredentialIssuerAdapter } from './apsCredentialIssuerAdapter';

export const credentialIssuerPluginDefinition: CredentialIssuerPluginDefinition = {
  code: 'aps-credential-issuer-v3',
  metadata: {
    code: 'aps-credential-issuer-v3',
    name: 'APS Directory API credential issuer',
    version: 'v3',
  },
  createAdapter: (config) => new ApsCredentialIssuerAdapter(config),
};
