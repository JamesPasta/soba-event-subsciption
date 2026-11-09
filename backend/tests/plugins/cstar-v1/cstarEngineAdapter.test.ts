import { tenantEnginePluginDefinition } from '../../../src/plugins/cstar-v1';
import {
  CstarEngineAdapter,
  resolveCstarUserId,
} from '../../../src/plugins/cstar-v1/cstarEngineAdapter';
import {
  createPluginConfigReaderFrom,
  type PluginConfigReader,
} from '../../../src/core/config/pluginConfig';
import { createEnvReader } from '../../../src/core/config/env';
import { ServiceUnavailableError } from '../../../src/core/errors';
import { log } from '../../../src/core/logging';
import { json, startCstar, type CstarHandler, type FakeCstar } from './fakeCstar';

const USER_ID = 'F45AFBBD68C44D6F956BA3A1D9181399';
const IDIR_CLAIMS = { identity_provider: 'idir', idir_user_guid: USER_ID };

const TENANT = {
  id: 'f98cbbfb-b96c-4a40-a10b-c2a7e795022c',
  name: 'Roads initiative',
  ministryName: 'Ministry of Transportation',
  description: null,
  createdDateTime: '2024-03-21',
  updatedDateTime: '2024-03-21',
  createdBy: USER_ID,
  updatedBy: null,
};

function makeConfig(values: Record<string, string>): PluginConfigReader {
  return createPluginConfigReaderFrom(
    createEnvReader(
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [`PLUGIN_CSTAR_V1_${key}`, value]),
      ),
    ),
    'cstar-v1',
  );
}

// What a base URL missing /api reaches: the CSTAR frontend, which answers every path with 200 HTML.
const frontendPage: CstarHandler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><p>CSTAR</p>');
};

describe('cstar-v1 plugin', () => {
  let cstar: FakeCstar | undefined;
  afterEach(async () => {
    await cstar?.close();
    cstar = undefined;
    jest.restoreAllMocks();
  });

  it('declares the expected definition', () => {
    expect(tenantEnginePluginDefinition.code).toBe('cstar-v1');
    expect(tenantEnginePluginDefinition.metadata).toEqual({
      code: 'cstar-v1',
      name: 'CSTAR',
      version: 'v1',
    });
  });

  it('requires the API base URL', () => {
    expect(() => new CstarEngineAdapter(makeConfig({}))).toThrow(
      'PLUGIN_CSTAR_V1_API_BASE_URL is required',
    );
  });

  it.each([
    ['IDIR', IDIR_CLAIMS, USER_ID],
    ['Azure IDIR', { identity_provider: 'azureidir', idir_user_guid: USER_ID }, USER_ID],
    ['BCeID Business', { identity_provider: 'bceidbusiness', bceid_user_guid: 'B1' }, 'B1'],
    [
      'BCeID Both with a business guid',
      { identity_provider: 'bceidboth', bceid_user_guid: 'B1', bceid_business_guid: 'BB' },
      'B1',
    ],
    ['the idp claim', { idp: 'idir', idir_user_guid: USER_ID }, USER_ID],
    ['BCeID Both without a business guid', { identity_provider: 'bceidboth' }, null],
    ['BCeID Basic', { identity_provider: 'bceidbasic', bceid_user_guid: 'B1' }, null],
    ['BC Services Card', { identity_provider: 'bcservicescard', sub: 'S1' }, null],
    ['a token with no provider', { login: 'octocat', sub: '1' }, null],
    ['IDIR without a user guid', { identity_provider: 'idir' }, null],
  ])('resolveCstarUserId: %s', (_label, claims, expected) => {
    expect(resolveCstarUserId(claims)).toBe(expected);
  });

  it("getTenants returns the caller's tenants, sending their token", async () => {
    cstar = await startCstar(
      json(200, { data: { tenants: [{ ...TENANT, users: [{ id: 'u1' }] }] } }),
    );
    // A trailing slash on the base URL is tolerated.
    const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: `${cstar.baseUrl}/` }));

    const tenants = await adapter.getTenants({ token: 'tok', claims: IDIR_CLAIMS });

    expect(tenants).toEqual([TENANT]);
    expect(cstar.requests).toEqual([
      { url: `/api/v1/users/${USER_ID}/tenants`, authorization: 'Bearer tok' },
    ]);
  });

  it('getTenants encodes the user id into the path', async () => {
    cstar = await startCstar(json(200, { data: { tenants: [] } }));
    const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: cstar.baseUrl }));

    await adapter.getTenants({
      token: 'tok',
      claims: { identity_provider: 'idir', idir_user_guid: '../a?b' },
    });

    expect(cstar.requests[0].url).toBe('/api/v1/users/..%2Fa%3Fb/tenants');
  });

  it('getTenants returns no tenants and makes no request for an unsupported identity provider', async () => {
    cstar = await startCstar(json(200, { data: { tenants: [TENANT] } }));
    const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: cstar.baseUrl }));

    const tenants = await adapter.getTenants({
      token: 'tok',
      claims: { identity_provider: 'bceidbasic', bceid_user_guid: 'B1' },
    });

    expect(tenants).toEqual([]);
    expect(cstar.requests).toHaveLength(0);
  });

  it.each([400, 401, 403, 404, 500])(
    'getTenants maps a CSTAR %i to ServiceUnavailableError',
    async (status) => {
      cstar = await startCstar(json(status, { message: 'upstream detail' }));
      const warn = jest.spyOn(log, 'warn');
      const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: cstar.baseUrl }));

      const failure = adapter.getTenants({ token: 'tok', claims: IDIR_CLAIMS });
      await expect(failure).rejects.toThrow(ServiceUnavailableError);
      await expect(failure).rejects.toThrow(new Error(`CSTAR error ${status}`));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ plugin: 'cstar-v1', status }),
        'CSTAR tenants request failed',
      );
    },
  );

  it('getTenants maps a non-JSON body to ServiceUnavailableError', async () => {
    cstar = await startCstar(frontendPage);
    const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: cstar.baseUrl }));

    await expect(adapter.getTenants({ token: 'tok', claims: IDIR_CLAIMS })).rejects.toThrow(
      ServiceUnavailableError,
    );
  });

  it('getTenants maps an unexpected response shape to ServiceUnavailableError', async () => {
    cstar = await startCstar(json(200, { data: { tenants: [{ id: 't1' }] } }));
    const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: cstar.baseUrl }));

    await expect(adapter.getTenants({ token: 'tok', claims: IDIR_CLAIMS })).rejects.toThrow(
      'CSTAR returned an unexpected tenants response',
    );
  });

  it('getTenants gives up after the configured timeout', async () => {
    cstar = await startCstar(() => {
      // Never answers.
    });
    const adapter = new CstarEngineAdapter(
      makeConfig({ API_BASE_URL: cstar.baseUrl, TIMEOUT_MS: '200' }),
    );

    const started = Date.now();
    await expect(adapter.getTenants({ token: 'tok', claims: IDIR_CLAIMS })).rejects.toThrow(
      new ServiceUnavailableError('CSTAR is unavailable'),
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('readinessCheck is ok when CSTAR health answers with its JSON body', async () => {
    cstar = await startCstar(json(200, { apiStatus: 'Healthy', time: '2026-09-25T21:01:05Z' }));
    const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: cstar.baseUrl }));

    await expect(adapter.readinessCheck()).resolves.toEqual({ ok: true });
    expect(cstar.requests[0]).toEqual({ url: '/api/v1/health', authorization: undefined });
  });

  it('readinessCheck is not ok when the base URL reaches the CSTAR frontend', async () => {
    cstar = await startCstar(frontendPage);
    const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: cstar.baseUrl }));

    await expect(adapter.readinessCheck()).resolves.toEqual({
      ok: false,
      message: 'Unexpected CSTAR health response',
    });
  });

  it('readinessCheck is not ok on a 404', async () => {
    cstar = await startCstar(json(404, { message: 'Cannot GET' }));
    const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: cstar.baseUrl }));

    await expect(adapter.readinessCheck()).resolves.toEqual({
      ok: false,
      message: 'HTTP 404 Not Found',
    });
  });

  it('readinessCheck is not ok when CSTAR is unreachable', async () => {
    cstar = await startCstar(json(200, {}));
    const { baseUrl } = cstar;
    await cstar.close();
    cstar = undefined;
    const adapter = new CstarEngineAdapter(makeConfig({ API_BASE_URL: baseUrl }));

    const result = await adapter.readinessCheck();
    expect(result.ok).toBe(false);
  });
});
