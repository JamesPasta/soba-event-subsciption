import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeaturesMetaPayload } from '@/src/shared/config/featuresMeta';

const sampleMeta: FeaturesMetaPayload = {
  features: [
    {
      code: 'design-mode',
      name: 'Design mode',
      description: null,
      version: null,
      status: 'enabled',
      availability: 'fixed',
      platformAllowed: true,
    },
    {
      code: 'submit-mode',
      name: 'Submit mode',
      description: null,
      version: null,
      status: 'enabled',
      availability: 'fixed',
      platformAllowed: true,
    },
    {
      code: 'off-mode',
      name: 'Off',
      description: null,
      version: null,
      status: 'disabled',
      availability: 'fixed',
      platformAllowed: false,
    },
  ],
};

describe('createIsFeatureAllowed', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('denies all gated features when NEXT_PUBLIC_SOBA_FEATURES_ALLOWED is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOBA_FEATURES_ALLOWED', '');
    const { createIsFeatureAllowed } = await import('@/src/shared/featureFlags/flags');
    const allow = createIsFeatureAllowed(sampleMeta);
    expect(allow('design-mode')).toBe(false);
    expect(allow('submit-mode')).toBe(false);
    expect(allow('off-mode')).toBe(false);
  });

  it('allows every platform-allowed code when policy is *', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOBA_FEATURES_ALLOWED', '*');
    const { createIsFeatureAllowed } = await import('@/src/shared/featureFlags/flags');
    const allow = createIsFeatureAllowed(sampleMeta);
    expect(allow('design-mode')).toBe(true);
    expect(allow('submit-mode')).toBe(true);
    expect(allow('off-mode')).toBe(false);
  });

  it('allows every platform-allowed code when policy is all', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOBA_FEATURES_ALLOWED', 'ALL');
    const { createIsFeatureAllowed } = await import('@/src/shared/featureFlags/flags');
    const allow = createIsFeatureAllowed(sampleMeta);
    expect(allow('design-mode')).toBe(true);
    expect(allow('submit-mode')).toBe(true);
  });

  it('intersects with allowlist when env is non-empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOBA_FEATURES_ALLOWED', 'submit-mode');
    const { createIsFeatureAllowed } = await import('@/src/shared/featureFlags/flags');
    const allow = createIsFeatureAllowed(sampleMeta);
    expect(allow('design-mode')).toBe(false);
    expect(allow('submit-mode')).toBe(true);
  });

  it('returns false for unknown codes', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOBA_FEATURES_ALLOWED', '*');
    const { createIsFeatureAllowed } = await import('@/src/shared/featureFlags/flags');
    const allow = createIsFeatureAllowed(sampleMeta);
    expect(allow('unknown')).toBe(false);
  });
});

describe('listEnabledKnownFeatures', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns only known FEATURE_CODES that pass createIsFeatureAllowed', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOBA_FEATURES_ALLOWED', 'submit-mode');
    const { listEnabledKnownFeatures } = await import('@/src/shared/featureFlags/flags');
    expect(listEnabledKnownFeatures(sampleMeta)).toEqual(['submit-mode']);
  });

  it('returns empty list when env allowlist blocks all known codes', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOBA_FEATURES_ALLOWED', '');
    const { listEnabledKnownFeatures } = await import('@/src/shared/featureFlags/flags');
    expect(listEnabledKnownFeatures(sampleMeta)).toEqual([]);
  });
});
