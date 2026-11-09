import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SWRConfig, useSWRConfig } from 'swr';

const fetchCurrentUser = vi.fn();
vi.mock('@/src/shared/api/sobaApi', () => ({
  fetchCurrentUser: (...args: unknown[]) => fetchCurrentUser(...args),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { useAppSession } from '@/src/app/routing/useAppSession';

let store: ReturnType<typeof makeStore>;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        {children}
      </SWRConfig>
    </Provider>
  );
}

const USER = {
  actor: { id: 'user-1', displayLabel: 'User', status: 'active' },
  profile: { displayName: 'User', email: null, preferredUsername: null },
  preferences: { defaultWorkspaceId: null },
  capabilities: {
    canCreateWorkspace: true,
    hasWorkspaces: true,
    formCreate: 'allowed',
    isSobaAdmin: false,
  },
};

describe('useAppSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    fetchCurrentUser.mockResolvedValue(USER);
  });

  it('is ready once the current user has answered', async () => {
    const { result } = renderHook(() => useAppSession(), { wrapper });
    expect(result.current.sessionReady).toBe(false);
    await waitFor(() => expect(result.current.sessionReady).toBe(true));
    expect(result.current.sessionLoadedOnce).toBe(true);
    expect(result.current.hasWorkspaces).toBe(true);
    expect(result.current.canCreateWorkspace).toBe(true);
  });

  it('fails the session when the current user read fails', async () => {
    fetchCurrentUser.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAppSession(), { wrapper });
    await waitFor(() => expect(result.current.sessionFailed).toBe(true));
    expect(result.current.sessionReady).toBe(false);
    expect(result.current.sessionLoadedOnce).toBe(false);
  });

  // The latch is what stops the guard unmounting a route mid-form-fill on a background failure.
  it('keeps sessionLoadedOnce true when a later read fails', async () => {
    const { result } = renderHook(
      () => ({ session: useAppSession(), mutate: useSWRConfig().mutate }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.session.sessionLoadedOnce).toBe(true));

    fetchCurrentUser.mockRejectedValue(new Error('boom'));
    await act(async () => {
      await result.current.mutate(['me']).catch(() => undefined);
    });

    await waitFor(() => expect(result.current.session.sessionFailed).toBe(true));
    expect(result.current.session.sessionLoadedOnce).toBe(true);
    expect(result.current.session.sessionReady).toBe(false);
  });

  // A user in more workspaces than any picker shows still has workspaces, so this never reads one.
  it('takes workspace presence from the current user', async () => {
    fetchCurrentUser.mockResolvedValue({
      ...USER,
      capabilities: { ...USER.capabilities, hasWorkspaces: false },
    });
    const { result } = renderHook(() => useAppSession(), { wrapper });
    await waitFor(() => expect(result.current.sessionReady).toBe(true));
    expect(result.current.hasWorkspaces).toBe(false);
  });

  it('reports no onboarding need when the user has workspaces', async () => {
    const { result } = renderHook(() => useAppSession(), { wrapper });
    await waitFor(() => expect(result.current.sessionReady).toBe(true));
    expect(result.current.needsOnboarding).toBe(false);
  });

  it('needs onboarding with no workspaces and no way to create one', async () => {
    fetchCurrentUser.mockResolvedValue({
      ...USER,
      capabilities: { ...USER.capabilities, hasWorkspaces: false, canCreateWorkspace: false },
    });
    const { result } = renderHook(() => useAppSession(), { wrapper });
    await waitFor(() => expect(result.current.needsOnboarding).toBe(true));
  });
});
