import type { PluginConfigReader } from '../../core/config/pluginConfig';
import type { TenantEnginePluginDefinition } from '../../core/integrations/tenant/TenantEnginePluginDefinition';
import { CstarEngineAdapter } from './cstarEngineAdapter';

const CODE = 'cstar-v1';

export const tenantEnginePluginDefinition: TenantEnginePluginDefinition = {
  code: CODE,
  metadata: {
    code: CODE,
    name: 'CSTAR',
    version: 'v1',
  },
  createAdapter: (config: PluginConfigReader) => new CstarEngineAdapter(config),
};
