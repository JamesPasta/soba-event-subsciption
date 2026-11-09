import { tenantEnginePluginDefinition } from '../../../src/plugins/tenant-noop';
import { createPluginConfigReader } from '../../../src/core/config/pluginConfig';

describe('tenant-noop', () => {
  const adapter = tenantEnginePluginDefinition.createAdapter(
    createPluginConfigReader(tenantEnginePluginDefinition.code),
  );

  it('has the expected code', () => {
    expect(tenantEnginePluginDefinition.code).toBe('tenant-noop');
  });

  it('returns no tenants', async () => {
    await expect(
      adapter.getTenants({
        token: 'tok',
        claims: { identity_provider: 'idir', idir_user_guid: 'F45AFBBD' },
      }),
    ).resolves.toEqual([]);
  });

  it('has no readiness check', () => {
    expect(adapter.readinessCheck).toBeUndefined();
  });
});
