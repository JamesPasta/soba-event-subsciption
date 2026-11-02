import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FormSettingsSection } from '@/src/features/form-settings/types';

const { mockLoadFeaturesMeta, mockFetchFeatureAvailability } = vi.hoisted(() => ({
  mockLoadFeaturesMeta: vi.fn(),
  mockFetchFeatureAvailability: vi.fn(),
}));

vi.mock('@/src/shared/config/featuresMeta', () => ({
  loadFeaturesMeta: mockLoadFeaturesMeta,
}));

vi.mock('@/src/shared/featureFlags/featureAvailability', () => ({
  fetchFeatureAvailability: mockFetchFeatureAvailability,
}));

import { resolveAvailableSectionIds } from '@/src/features/form-settings/data/sections';
import { formSettingsSections } from '@/src/features/form-settings/registry';

const Drawer = () => null;
const section = (over: Partial<FormSettingsSection>): FormSettingsSection => ({
  id: 'section',
  weight: 10,
  Drawer,
  ...over,
});
const scope = { workspaceId: 'ws1', formId: 'f1' };
const metaAllowing = (code: string) => ({
  features: [{ code, platformAllowed: true, availability: 'fixed' }],
});

describe('form settings sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SOBA_FEATURES_ALLOWED', '*');
  });

  it('orders the Settings tab by weight', () => {
    expect(formSettingsSections.map((s) => s.id)).toEqual([
      'form-settings',
      'form-profile',
      'form-audience',
      'submitter-settings',
      'review-settings',
      'document-templates',
    ]);
  });

  it('keeps a section without a feature without asking anyone', async () => {
    await expect(resolveAvailableSectionIds([section({ id: 'plain' })], scope)).resolves.toEqual([
      'plain',
    ]);
    expect(mockLoadFeaturesMeta).not.toHaveBeenCalled();
    expect(mockFetchFeatureAvailability).not.toHaveBeenCalled();
  });

  it('uses the deployment flags for a fixed feature', async () => {
    mockLoadFeaturesMeta.mockResolvedValue(metaAllowing('files'));
    const sections = [
      section({ id: 'on', featureCode: 'files' }),
      section({ id: 'off', featureCode: 'document-generation' }),
    ];
    await expect(resolveAvailableSectionIds(sections, scope)).resolves.toEqual(['on']);
    expect(mockFetchFeatureAvailability).not.toHaveBeenCalled();
  });

  it('asks the server about a scoped feature for this form', async () => {
    mockFetchFeatureAvailability.mockResolvedValue(true);
    const sections = [
      section({ id: 'granted', featureCode: 'document-generation-v3', scoped: true }),
    ];
    await expect(resolveAvailableSectionIds(sections, scope)).resolves.toEqual(['granted']);
    expect(mockFetchFeatureAvailability).toHaveBeenCalledWith('document-generation-v3', scope);
    expect(mockLoadFeaturesMeta).not.toHaveBeenCalled();
  });

  // A check that cannot answer must not show a section its feature may not allow.
  it('hides a fixed feature when the flags cannot be loaded', async () => {
    mockLoadFeaturesMeta.mockRejectedValue(new Error('offline'));
    await expect(
      resolveAvailableSectionIds([section({ id: 'gated', featureCode: 'files' })], scope),
    ).resolves.toEqual([]);
  });
});
