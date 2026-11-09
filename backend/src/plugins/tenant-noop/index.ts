import type { TenantEngineAdapter } from '../../core/integrations/tenant/TenantEngineAdapter';
import type { TenantEnginePluginDefinition } from '../../core/integrations/tenant/TenantEnginePluginDefinition';

const CODE = 'tenant-noop';

/** No-op tenant engine: every caller has no tenants, no external call. */
function createNoopTenantEngineAdapter(): TenantEngineAdapter {
  return {
    getTenants() {
      return Promise.resolve([]);
    },
  };
}

export const tenantEnginePluginDefinition: TenantEnginePluginDefinition = {
  code: CODE,
  metadata: {
    code: CODE,
    name: 'No-op tenant engine',
  },
  createAdapter: createNoopTenantEngineAdapter,
};
