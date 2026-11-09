import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const availability = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock('@/src/shared/featureFlags/featureAvailability', () => ({
  fetchFeatureAvailability: availability.check,
}));

import { usePostSubmissionAvailable } from '@/src/features/post-submission/data/usePostSubmissionAvailable';

// One cache for every mount, as the app keeps one for the whole browser session.
const cache = new Map();
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
);
const scope = { workspaceId: 'ws1', formId: 'f1' };

describe('usePostSubmissionAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it('asks again on each mount, so a grant made since the last visit shows', async () => {
    availability.check.mockResolvedValue(false);
    const first = renderHook(() => usePostSubmissionAvailable(scope), { wrapper });
    await waitFor(() => expect(first.result.current).toBe(false));
    first.unmount();

    availability.check.mockResolvedValue(true);
    const second = renderHook(() => usePostSubmissionAvailable(scope), { wrapper });
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(availability.check).toHaveBeenCalledTimes(2);
    expect(availability.check).toHaveBeenLastCalledWith('post-submission', scope);
  });

  it('is undefined while the check runs, and false without asking when there is no scope', async () => {
    availability.check.mockReturnValue(new Promise(() => undefined));
    expect(
      renderHook(() => usePostSubmissionAvailable(scope), { wrapper }).result.current,
    ).toBeUndefined();
    expect(renderHook(() => usePostSubmissionAvailable(null), { wrapper }).result.current).toBe(
      false,
    );
    expect(availability.check).toHaveBeenCalledTimes(1);
  });
});
