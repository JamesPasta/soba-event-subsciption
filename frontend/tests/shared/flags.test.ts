import { describe, it, expect, vi } from 'vitest';
import {
  normalizeFeatureCode,
  parseFrontendFeaturesAllowlist,
  createIsFeatureAllowed,
} from '@/src/shared/featureFlags/flags';
import type { FeaturesMetaPayload } from '@/src/shared/config/featuresMeta';

const sampleMeta = {
  features: [
    {
      code: 'meta',
      name: 'Meta',
      description: null,
      version: null,
      status: 'active',
      platformAllowed: true,
    },
    {
      code: 'design-mode',
      name: 'Design Mode',
      description: null,
      version: null,
      status: 'active',
      platformAllowed: true,
    },
    {
      code: 'submit-mode',
      name: 'Submit Mode',
      description: null,
      version: null,
      status: 'inactive',
      platformAllowed: false,
    },
  ],
};

describe('feature flags utilities', () => {
  it('normalizeFeatureCode trims and lowercases', () => {
    expect(normalizeFeatureCode('  DESIGN-MODE ')).toBe('design-mode');
  });

  it('parseFrontendFeaturesAllowlist handles undefined and wildcard', () => {
    expect(parseFrontendFeaturesAllowlist(undefined)).toEqual(new Set());
    expect(parseFrontendFeaturesAllowlist('*')).toBe('all');
    const set = parseFrontendFeaturesAllowlist(' meta , design-mode ');
    expect(set instanceof Set).toBeTruthy();
    expect((set as Set<string>).has('meta')).toBeTruthy();
  });

  it('createIsFeatureAllowed respects platform and frontend policy', () => {
    const meta = sampleMeta as unknown as FeaturesMetaPayload;
    const fn = createIsFeatureAllowed(meta);
    // By default process.env likely doesn't include features so none allowed
    expect(fn('meta')).toBe(false);
  });

  it('createIsFeatureAllowed hides scoped features (can only be resolved with scope)', () => {
    vi.stubEnv('NEXT_PUBLIC_SOBA_FEATURES_ALLOWED', '*');
    const meta = {
      features: [
        {
          code: 'doc-fixed',
          name: 'Fixed',
          description: null,
          version: null,
          status: 'enabled',
          platformAllowed: true,
          availability: 'fixed',
        },
        {
          code: 'doc-scoped',
          name: 'Scoped',
          description: null,
          version: null,
          status: 'enabled',
          platformAllowed: true,
          availability: 'scoped',
        },
        {
          code: 'legacy',
          name: 'Legacy',
          description: null,
          version: null,
          status: 'enabled',
          platformAllowed: true,
        },
      ],
    } as unknown as FeaturesMetaPayload;
    const fn = createIsFeatureAllowed(meta);

    expect(fn('doc-fixed')).toBe(true);
    // Scoped resolves false even though platform- and frontend-allowed.
    expect(fn('doc-scoped')).toBe(false);
    // Missing availability is treated as non-scoped.
    expect(fn('legacy')).toBe(true);

    vi.unstubAllEnvs();
  });
});
