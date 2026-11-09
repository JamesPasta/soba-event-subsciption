import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { useDownload } from '@/src/shared/api/useDownload';

let store: ReturnType<typeof makeStore>;

function wrapper({ children }: { children: React.ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}

describe('useDownload', () => {
  beforeEach(() => {
    store = makeStore();
  });

  it('does not read before sign-in', async () => {
    const load = vi.fn();
    let result!: { current: ReturnType<typeof useDownload> };
    await act(async () => {
      ({ result } = renderHook(() => useDownload(load), { wrapper }));
    });
    expect(load).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
  });

  it('reads once when the session is ready, across rerenders', async () => {
    const file = { blob: new Blob(['x']), filename: 'plan.pdf' };
    const load = vi.fn().mockResolvedValue(file);
    let hook!: ReturnType<typeof renderHook<ReturnType<typeof useDownload>, unknown>>;
    await act(async () => {
      // A new loader each render, as a component passes it.
      hook = renderHook(() => useDownload((token) => load(token)), { wrapper });
    });

    await act(async () => {
      store.dispatch(setToken('token'));
      store.dispatch(setAuthenticated(true));
    });
    await waitFor(() => expect(hook.result.current.data).toBe(file));
    hook.rerender();

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('token');
    expect(hook.result.current.isLoading).toBe(false);
  });
});
