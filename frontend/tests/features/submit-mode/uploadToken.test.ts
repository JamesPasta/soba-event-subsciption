import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTokenRefresher, type RefreshOutcome } from '@/src/shared/auth/tokenRefresh';
import { isSessionExpired } from '@/src/shared/api/sobaFetch';
import {
  clearActiveSubmission,
  setActiveSubmission,
} from '@/src/features/formio-v5/activeSubmission';
import { uploadToken } from '@/src/features/formio-v5/data/uploadToken';

const refreshTo = (outcome: RefreshOutcome) => setTokenRefresher(async () => outcome);
const filling = (signedIn: boolean) => setActiveSubmission({ submissionId: 'sub-1', signedIn });

describe('uploadToken', () => {
  beforeEach(() => clearActiveSubmission());
  afterEach(() => {
    setTokenRefresher(null);
    clearActiveSubmission();
  });

  it('sends the refreshed token', async () => {
    refreshTo({ status: 'token', token: 'fresh' });
    filling(true);
    await expect(uploadToken(() => 'held')).resolves.toBe('fresh');
  });

  it('sends what the instance holds when the refresh reached no verdict', async () => {
    refreshTo({ status: 'unavailable' });
    filling(true);
    await expect(uploadToken(() => 'held')).resolves.toBe('held');
  });

  it.each([
    ['an ended session', { status: 'no-session' } as RefreshOutcome, () => 'stale'],
    ['no verdict and no token', { status: 'unavailable' } as RefreshOutcome, () => undefined],
  ])('refuses a signed-in fill with %s', async (_label, outcome, instanceToken) => {
    refreshTo(outcome);
    filling(true);
    const refused = await uploadToken(instanceToken).catch((err: unknown) => err);
    expect(isSessionExpired(refused)).toBe(true);
  });

  it('sends no token for an anonymous fill', async () => {
    refreshTo({ status: 'no-session' });
    filling(false);
    await expect(uploadToken(() => undefined)).resolves.toBe('');
  });

  it('sends no token outside a fill when the session ended', async () => {
    refreshTo({ status: 'no-session' });
    await expect(uploadToken(() => 'stale')).resolves.toBe('');
  });
});
