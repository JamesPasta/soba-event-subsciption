import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApsCredentialIssuerAdapter } from '../../../src/plugins/aps-credential-issuer-v3/apsCredentialIssuerAdapter';
import { createPluginConfigReaderFrom } from '../../../src/core/config/pluginConfig';
import { createEnvReader } from '../../../src/core/config/env';
import { clearOAuth2TokenCache } from '../../../src/core/auth/oauth2TokenProvider';
import { CredentialRequestRejectedError } from '../../../src/core/integrations/credential-issuer/CredentialIssuerAdapter';

interface RecordedRequest {
  path: string;
  method?: string;
  body: string;
  authorization?: string;
}
const receipt = { flow: 'kong-api-key-acl', clientId: 'env-app', apiKey: 'secret-value' };

describe('APS credential issuer', () => {
  let server: Server;
  let origin: string;
  let requests: RecordedRequest[];
  let status: number;
  let responseBody: string;
  let tokenStatus: number;
  let stall: boolean;
  let rejectOnce: boolean;

  beforeEach(async () => {
    clearOAuth2TokenCache();
    requests = [];
    status = 201;
    tokenStatus = 200;
    responseBody = JSON.stringify(receipt);
    stall = false;
    rejectOnce = false;
    server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      requests.push({
        path: req.url!,
        method: req.method,
        body,
        authorization: req.headers.authorization,
      });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/token') {
        res.statusCode = tokenStatus;
        res.end(JSON.stringify({ access_token: 'issuer-token', expires_in: 3600 }));
        return;
      }
      if (stall) return;
      res.statusCode = rejectOnce ? 401 : status;
      rejectOnce = false;
      res.end(responseBody);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearOAuth2TokenCache();
  });

  const adapter = (timeout = 1000) =>
    new ApsCredentialIssuerAdapter(
      createPluginConfigReaderFrom(
        createEnvReader({
          PLUGIN_APS_CREDENTIAL_ISSUER_V3_API_BASE_URL: `${origin}/ds/api/v3`,
          PLUGIN_APS_CREDENTIAL_ISSUER_V3_GATEWAY_ID: 'gateway/id',
          PLUGIN_APS_CREDENTIAL_ISSUER_V3_ENVIRONMENT_APP_ID: 'env',
          PLUGIN_APS_CREDENTIAL_ISSUER_V3_TOKEN_URL: `${origin}/token`,
          PLUGIN_APS_CREDENTIAL_ISSUER_V3_CLIENT_ID: 'issuer',
          PLUGIN_APS_CREDENTIAL_ISSUER_V3_CLIENT_SECRET: 'issuer-secret',
          PLUGIN_APS_CREDENTIAL_ISSUER_V3_TIMEOUT_MS: String(timeout),
        }),
        'aps-credential-issuer-v3',
      ),
    );

  it('issues with configured environment, ACLs and labels, authenticating as issuer', async () => {
    expect(
      await adapter().issue({
        applicationName: 'Workspace',
        labels: { owner: 'soba' },
        aclGroups: ['workspace-id'],
      }),
    ).toEqual(receipt);
    const request = requests[1];
    expect(request.path).toBe('/ds/api/v3/gateways/gateway%2Fid/consumers');
    expect(request.method).toBe('POST');
    expect(request.authorization).toBe('Bearer issuer-token');
    expect(JSON.parse(request.body)).toEqual({
      environmentAppId: 'env',
      application: { name: 'Workspace' },
      labels: { owner: 'soba' },
      controls: { aclGroups: ['workspace-id'] },
    });
    expect(new URLSearchParams(requests[0].body).get('client_secret')).toBe('issuer-secret');
  });

  it('omits empty controls and caches tokens across adapter instances', async () => {
    await adapter().issue({ applicationName: 'Workspace', aclGroups: [] });
    await adapter().issue({ applicationName: 'Another' });
    expect(JSON.parse(requests[1].body)).not.toHaveProperty('controls');
    expect(requests.filter((request) => request.path === '/token')).toHaveLength(1);
  });

  it('rotates with PUT and an encoded consumer id', async () => {
    status = 200;
    const rotated = { ...receipt, clientId: 'consumer/id' };
    responseBody = JSON.stringify(rotated);
    await expect(adapter().regenerate('consumer/id')).resolves.toEqual(rotated);
    expect(requests[1]).toMatchObject({
      method: 'PUT',
      path: '/ds/api/v3/gateways/gateway%2Fid/consumers/consumer%2Fid?action=regenerate',
      body: '',
    });
  });

  it('refuses invalid inputs before any network call', async () => {
    await expect(adapter().issue({ applicationName: '' })).rejects.toBeInstanceOf(
      CredentialRequestRejectedError,
    );
    await expect(adapter().regenerate(' ')).rejects.toBeInstanceOf(CredentialRequestRejectedError);
    expect(requests).toHaveLength(0);
  });

  it('checks token authentication without issuing credentials', async () => {
    expect(await adapter().readinessCheck()).toEqual({
      ok: true,
      message: 'Issuer token acquired; gateway issuance permission not checked',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/token');
  });

  it('reports token failure safely, as a refusal that reached no gateway', async () => {
    tokenStatus = 401;
    expect(await adapter().readinessCheck()).toEqual({
      ok: false,
      message: 'APS issuer authentication failed',
    });
    await expect(adapter().issue({ applicationName: 'Workspace' })).rejects.toBeInstanceOf(
      CredentialRequestRejectedError,
    );
    expect(requests.every((request) => request.path === '/token')).toBe(true);
  });

  it('refreshes the token once after a confirmed 401', async () => {
    rejectOnce = true;
    await expect(adapter().issue({ applicationName: 'Workspace' })).resolves.toEqual(receipt);
    expect(requests.filter((request) => request.path === '/token')).toHaveLength(2);
    expect(requests.filter((request) => request.path !== '/token')).toHaveLength(2);
  });

  it('reports a token failure after a 401 as a refusal, without retrying', async () => {
    const issuer = adapter();
    await issuer.readinessCheck();
    rejectOnce = true;
    tokenStatus = 401;
    const error = await issuer.regenerate(receipt.clientId).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CredentialRequestRejectedError);
    expect((error as CredentialRequestRejectedError).upstreamStatus).toBeUndefined();
    expect(requests.filter((request) => request.path === '/token')).toHaveLength(2);
    expect(requests.filter((request) => request.path !== '/token')).toHaveLength(1);
  });

  it.each([400, 401, 403, 404, 409, 422, 500])(
    'sanitizes HTTP %s and does not retry other rejections',
    async (upstreamStatus) => {
      status = upstreamStatus;
      responseBody = 'secret-value issuer-secret';
      const error = await adapter()
        .issue({ applicationName: 'Workspace' })
        .catch((err: unknown) => err);
      if (upstreamStatus < 500) {
        expect(error).toBeInstanceOf(CredentialRequestRejectedError);
        expect(error).toMatchObject({ upstreamStatus });
      } else {
        expect(error).toMatchObject({ statusCode: 503, upstreamStatus });
      }
      expect(String(error)).not.toContain('secret-value');
      expect(String(error)).not.toContain('issuer-secret');
      expect(requests.filter((request) => request.path !== '/token')).toHaveLength(
        upstreamStatus === 401 ? 2 : 1,
      );
    },
  );

  it.each([
    'not JSON',
    '{}',
    JSON.stringify({ ...receipt, apiKey: '' }),
    JSON.stringify({ ...receipt, flow: 'client-credentials' }),
  ])('rejects malformed or unsupported success response %s without retrying', async (body) => {
    responseBody = body;
    await expect(adapter().issue({ applicationName: 'Workspace' })).rejects.toThrow();
    expect(requests.filter((request) => request.path !== '/token')).toHaveLength(1);
  });

  it('does not retry an uncertain timeout', async () => {
    stall = true;
    await expect(adapter(150).issue({ applicationName: 'Workspace' })).rejects.toThrow(
      'outcome may be unknown',
    );
    expect(requests.filter((request) => request.path !== '/token')).toHaveLength(1);
  });
  it.each([false, true])(
    'rejects regeneration identity mismatch even after a 401 retry (%s)',
    async (retry) => {
      rejectOnce = retry;
      const error = await adapter()
        .regenerate('expected-consumer')
        .catch((err: unknown) => err);
      expect(error).toMatchObject({ statusCode: 503 });
      expect(String(error)).toContain('different consumer identity');
      expect(String(error)).not.toContain(receipt.apiKey);
      expect(requests.filter((request) => request.path !== '/token')).toHaveLength(retry ? 2 : 1);
    },
  );

  it('can report readiness from a cached token while the gateway rejects issuance', async () => {
    const issuer = adapter();
    await expect(issuer.readinessCheck()).resolves.toMatchObject({ ok: true });
    tokenStatus = 401;
    status = 403;
    await expect(issuer.readinessCheck()).resolves.toMatchObject({ ok: true });
    expect(requests).toHaveLength(1);
    await expect(issuer.issue({ applicationName: 'Workspace' })).rejects.toMatchObject({
      upstreamStatus: 403,
    });
    expect(requests.filter((request) => request.path === '/token')).toHaveLength(1);
  });

  it('refreshes and retries regeneration once without changing the target', async () => {
    rejectOnce = true;
    await expect(adapter().regenerate(receipt.clientId)).resolves.toEqual(receipt);
    const attempts = requests.filter((request) => request.path !== '/token');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(requests.filter((request) => request.path === '/token')).toHaveLength(2);
  });

  it('does not retry or expose a malformed regeneration result', async () => {
    responseBody = JSON.stringify({ ...receipt, apiKey: '', privateDetail: 'private-value' });
    const error = await adapter()
      .regenerate(receipt.clientId)
      .catch((err: unknown) => err);
    expect(error).toMatchObject({ statusCode: 503 });
    expect(String(error)).toContain('reconcile the consumer');
    expect(String(error)).not.toContain('private-value');
    expect(requests.filter((request) => request.path !== '/token')).toHaveLength(1);
  });

  it('does not retry an uncertain regeneration timeout', async () => {
    stall = true;
    await expect(adapter(150).regenerate(receipt.clientId)).rejects.toThrow(
      'outcome may be unknown',
    );
    expect(requests.filter((request) => request.path !== '/token')).toHaveLength(1);
  });

  it('reports a refused regeneration with its status, without retrying', async () => {
    status = 404;
    const error = await adapter()
      .regenerate(receipt.clientId)
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CredentialRequestRejectedError);
    expect(error).toMatchObject({ upstreamStatus: 404 });
    expect(requests.filter((request) => request.path !== '/token')).toHaveLength(1);
  });
});
