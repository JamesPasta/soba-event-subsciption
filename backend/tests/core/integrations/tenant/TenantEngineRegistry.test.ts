import {
  checkTenantEngineReadiness,
  createDefaultTenantEngineAdapter,
  createTenantEngineAdapter,
  getTenantEnginePlugins,
  resolveDefaultTenantEngineCode,
  resolveTenantEnginePlugin,
} from '../../../../src/core/integrations/tenant/TenantEngineRegistry';
import { CstarEngineAdapter } from '../../../../src/plugins/cstar-v1/cstarEngineAdapter';

describe('TenantEngineRegistry', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('discovers the cstar and noop engines in its catalog', () => {
    const codes = getTenantEnginePlugins().map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['cstar-v1', 'tenant-noop']));
  });

  it('resolves an engine by code and rejects unknown codes', () => {
    expect(resolveTenantEnginePlugin('cstar-v1').metadata.version).toBe('v1');
    expect(() => resolveTenantEnginePlugin('nope')).toThrow(/No tenant engine plugin/);
  });

  it('creates an adapter for a configured engine', () => {
    process.env.PLUGIN_CSTAR_V1_API_BASE_URL = 'http://cstar.test/api/v1';
    expect(createTenantEngineAdapter('cstar-v1')).toBeInstanceOf(CstarEngineAdapter);
  });

  it('defaults the engine to tenant-noop, honouring the env override', () => {
    delete process.env.TENANT_ENGINE_DEFAULT_CODE;
    expect(resolveDefaultTenantEngineCode()).toBe('tenant-noop');

    process.env.TENANT_ENGINE_DEFAULT_CODE = 'cstar-v1';
    expect(resolveDefaultTenantEngineCode()).toBe('cstar-v1');
  });

  it('creates the default adapter without external config (noop)', async () => {
    delete process.env.TENANT_ENGINE_DEFAULT_CODE;
    const adapter = createDefaultTenantEngineAdapter();
    await expect(
      adapter.getTenants({ token: 'tok', claims: { identity_provider: 'idir' } }),
    ).resolves.toEqual([]);
  });

  it('reports readiness per engine, failing those missing config', async () => {
    delete process.env.PLUGIN_CSTAR_V1_API_BASE_URL;

    const readiness = await checkTenantEngineReadiness();

    expect(readiness['tenant-noop']).toEqual({ ok: true });
    expect(readiness['cstar-v1']).toEqual({
      ok: false,
      message: 'PLUGIN_CSTAR_V1_API_BASE_URL is required',
    });
  });
});
