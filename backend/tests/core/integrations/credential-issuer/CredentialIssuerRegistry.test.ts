import {
  checkCredentialIssuerReadiness,
  createDefaultCredentialIssuerAdapter,
  createCredentialIssuerAdapter,
  getCredentialIssuerPlugins,
  resolveDefaultCredentialIssuerCode,
  resolveCredentialIssuerPlugin,
} from '../../../../src/core/integrations/credential-issuer/CredentialIssuerRegistry';
import { createEnvReader } from '../../../../src/core/config/env';

describe('CredentialIssuerRegistry', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('discovers both implementations and rejects unknown codes', () => {
    expect(getCredentialIssuerPlugins().map((plugin) => plugin.code)).toEqual(
      expect.arrayContaining(['aps-credential-issuer-v3', 'credential-issuer-noop']),
    );
    expect(resolveCredentialIssuerPlugin('aps-credential-issuer-v3').metadata.version).toBe('v3');
    expect(() => resolveCredentialIssuerPlugin('missing')).toThrow('No credential issuer plugin');
  });

  it('defaults to the unavailable no-op and honors configuration', async () => {
    delete process.env.CREDENTIAL_ISSUER_DEFAULT_CODE;
    expect(resolveDefaultCredentialIssuerCode()).toBe('credential-issuer-noop');
    const issuer = createDefaultCredentialIssuerAdapter();
    expect(issuer.available).toBe(false);
    await expect(issuer.issue({ applicationName: 'test' })).rejects.toThrow(
      'Credential issuance is unavailable',
    );
    await expect(issuer.regenerate('consumer')).rejects.toThrow(
      'Credential issuance is unavailable',
    );
    process.env.CREDENTIAL_ISSUER_DEFAULT_CODE = 'aps-credential-issuer-v3';
    expect(resolveDefaultCredentialIssuerCode()).toBe('aps-credential-issuer-v3');
    expect(
      createEnvReader({
        CREDENTIAL_ISSUER_DEFAULT_CODE: 'aps-credential-issuer-v3',
      }).getCredentialIssuerDefaultCode(),
    ).toBe('aps-credential-issuer-v3');
  });

  it('reports absent configuration without throwing, and the no-op as ready', async () => {
    delete process.env.PLUGIN_APS_CREDENTIAL_ISSUER_V3_API_BASE_URL;
    expect(() => createCredentialIssuerAdapter('aps-credential-issuer-v3')).toThrow(
      'PLUGIN_APS_CREDENTIAL_ISSUER_V3_API_BASE_URL is required',
    );
    const readiness = await checkCredentialIssuerReadiness();
    expect(readiness['aps-credential-issuer-v3']).toEqual({
      ok: false,
      message: 'PLUGIN_APS_CREDENTIAL_ISSUER_V3_API_BASE_URL is required',
    });
    expect(readiness['credential-issuer-noop'].ok).toBe(true);
  });
});
