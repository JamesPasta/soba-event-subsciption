import {
  getActivePluginCodes,
  resolveActivePluginCode,
} from '../../../../src/core/integrations/plugins/PluginRegistry';

// resolveActivePluginCode reads process.env live, so these exercise the real single-source
// resolution that the adapter getters and /meta/plugins both go through.
describe('active plugin code resolution', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults match what the adapter getters instantiate', () => {
    delete process.env.CREDENTIAL_ISSUER_DEFAULT_CODE;
    expect(resolveActivePluginCode('credentialIssuer')).toBe('credential-issuer-noop');
    delete process.env.CACHE_DEFAULT_CODE;
    delete process.env.MESSAGEBUS_DEFAULT_CODE;
    delete process.env.TEMPSTORAGE_DEFAULT_CODE;
    delete process.env.VIRUSSCAN_DEFAULT_CODE;
    expect(resolveActivePluginCode('cache')).toBe('cache-memory');
    expect(resolveActivePluginCode('messagebus')).toBe('messagebus-memory');
    expect(resolveActivePluginCode('tempStorage')).toBe('tempstorage-os');
    expect(resolveActivePluginCode('virusScan')).toBe('virusscan-noop');

    const active = getActivePluginCodes();
    expect(active.has('credential-issuer-noop')).toBe(true);
    expect(active.has('cache-memory')).toBe(true);
    expect(active.has('messagebus-memory')).toBe(true);
    expect(active.has('tempstorage-os')).toBe(true);
    expect(active.has('virusscan-noop')).toBe(true);
  });

  it('reflects env overrides', () => {
    process.env.CREDENTIAL_ISSUER_DEFAULT_CODE = 'aps-credential-issuer-v3';
    expect(resolveActivePluginCode('credentialIssuer')).toBe('aps-credential-issuer-v3');
    process.env.CACHE_DEFAULT_CODE = 'cache-redis';
    process.env.MESSAGEBUS_DEFAULT_CODE = 'messagebus-redis';
    process.env.TEMPSTORAGE_DEFAULT_CODE = 'tempstorage-mount';
    process.env.VIRUSSCAN_DEFAULT_CODE = 'virusscan-clamav';
    expect(resolveActivePluginCode('cache')).toBe('cache-redis');
    expect(resolveActivePluginCode('messagebus')).toBe('messagebus-redis');
    expect(resolveActivePluginCode('tempStorage')).toBe('tempstorage-mount');
    expect(resolveActivePluginCode('virusScan')).toBe('virusscan-clamav');

    const active = getActivePluginCodes();
    expect(active.has('aps-credential-issuer-v3')).toBe(true);
    expect(active.has('credential-issuer-noop')).toBe(false);
    expect(active.has('cache-redis')).toBe(true);
    expect(active.has('messagebus-redis')).toBe(true);
    expect(active.has('tempstorage-mount')).toBe(true);
    expect(active.has('virusscan-clamav')).toBe(true);
    expect(active.has('cache-memory')).toBe(false);
    expect(active.has('tempstorage-os')).toBe(false);
    expect(active.has('virusscan-noop')).toBe(false);
  });
});
