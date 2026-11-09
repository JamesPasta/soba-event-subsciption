import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import { I18nProvider } from 'react-aria-components';

const fetchWorkspaces = vi.fn();
const lookupWorkspaces = vi.fn();
const selectWorkspace = vi.fn();
vi.mock('@/src/shared/api/sobaApi', () => ({
  fetchWorkspaces: (...args: unknown[]) => fetchWorkspaces(...args),
  lookupWorkspaces: (...args: unknown[]) => lookupWorkspaces(...args),
  selectWorkspace: (...args: unknown[]) => selectWorkspace(...args),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import {
  useWorkspaceOptions,
  useFormCreateWorkspaceOptions,
  useWorkspaceList,
  useRefreshWorkspaces,
  useWorkspace,
} from '@/src/shared/api/useWorkspaces';
import { ApiError } from '@/src/shared/api/sobaHelpers';

// Retries on, at a short interval, so a retry shows up within the test.
function retryingWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryInterval: 1 }}>
        {children}
      </SWRConfig>
    </Provider>
  );
}

type LookupOptions = { requiredPermissions?: readonly string[]; disclaimerAccepted?: boolean };

const formCreateCalls = () =>
  lookupWorkspaces.mock.calls.filter((call) => (call[1] as LookupOptions)?.requiredPermissions);

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

describe('useWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    lookupWorkspaces.mockImplementation((_token: string, options: LookupOptions = {}) =>
      Promise.resolve({
        items: options.requiredPermissions ? [{ id: 'ws2' }] : [{ id: 'ws1' }],
        limit: 500,
        truncated: false,
      }),
    );
  });

  it('reads the member options and the form-create options under separate keys', async () => {
    const { result } = renderHook(
      () => ({ all: useWorkspaceOptions(), creatable: useFormCreateWorkspaceOptions() }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.all.workspaces).toEqual([{ id: 'ws1' }]);
      expect(result.current.creatable.workspaces).toEqual([{ id: 'ws2' }]);
    });
    expect(formCreateCalls()).toHaveLength(1);
  });

  // The create gate on the server requires both permissions and an accepted disclaimer. Filtering
  // after the fetch would lose qualifying workspaces past the limit.
  it('asks the server for workspaces a form can be created in', async () => {
    renderHook(() => useFormCreateWorkspaceOptions(), { wrapper });
    await waitFor(() => expect(lookupWorkspaces).toHaveBeenCalled());
    expect(lookupWorkspaces).toHaveBeenCalledWith('token', {
      requiredPermissions: ['form_create', 'design_create'],
      disclaimerAccepted: true,
      locale: 'en',
    });
  });

  it('does not read the form-create options when disabled', async () => {
    const { result } = renderHook(() => useFormCreateWorkspaceOptions(false), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(false));
    expect(lookupWorkspaces).not.toHaveBeenCalled();
  });

  it('passes on that the options were cut off', async () => {
    lookupWorkspaces.mockResolvedValue({ items: [{ id: 'ws1' }], limit: 500, truncated: true });
    const { result } = renderHook(() => useWorkspaceOptions(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toMatchObject({ truncated: true, limit: 500 });
  });

  it('reads a single page for the list screen, and reports the total', async () => {
    fetchWorkspaces.mockResolvedValue({
      items: [{ id: 'ws1' }],
      page: { offset: 10, limit: 5, total: 42 },
    });
    const { result } = renderHook(
      () => useWorkspaceList({ offset: 10, limit: 5, sort: 'name:asc', q: 'pay' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.total).toBe(42));
    expect(fetchWorkspaces).toHaveBeenCalledWith('token', {
      offset: 10,
      limit: 5,
      sort: 'name:asc',
      q: 'pay',
      locale: 'en',
    });
  });

  it('sorts the list screen in the app language', async () => {
    fetchWorkspaces.mockResolvedValue({ items: [], page: { offset: 0, limit: 5, total: 0 } });
    const french = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider locale="fr-CA">{wrapper({ children })}</I18nProvider>
    );
    renderHook(() => useWorkspaceList({ offset: 0, limit: 5, sort: 'name:asc' }), {
      wrapper: french,
    });
    await waitFor(() =>
      expect(fetchWorkspaces).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({ locale: 'fr' }),
      ),
    );
  });

  // The form-create options filter on the disclaimer. Refreshing only the list screen leaves the
  // designer offering a workspace whose disclaimer was just revoked.
  it('refreshes the pickers and the page the list screen is showing', async () => {
    fetchWorkspaces.mockResolvedValue({ items: [], page: { offset: 0, limit: 10, total: 0 } });
    const { result } = renderHook(
      () => ({
        all: useWorkspaceOptions(),
        creatable: useFormCreateWorkspaceOptions(),
        list: useWorkspaceList({ offset: 0, limit: 10, sort: 'name:asc' }),
        refresh: useRefreshWorkspaces(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(lookupWorkspaces).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalledTimes(1));

    await result.current.refresh();
    await waitFor(() => expect(lookupWorkspaces).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalledTimes(2));
    expect(formCreateCalls()).toHaveLength(2);
  });

  it('falls back to empty options when items is not an array', async () => {
    lookupWorkspaces.mockResolvedValue({ items: null });
    const { result } = renderHook(() => useWorkspaceOptions(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.workspaces).toEqual([]);
    expect(result.current.truncated).toBe(false);
  });
  it('does not retry a single workspace read that was refused', async () => {
    selectWorkspace.mockRejectedValue(new ApiError('Workspace not found', 404));
    const { result } = renderHook(() => useWorkspace('ws1'), { wrapper: retryingWrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(selectWorkspace).toHaveBeenCalledTimes(1);
  });

  it('retries a single workspace read that failed for another reason', async () => {
    selectWorkspace.mockRejectedValue(new ApiError('Request failed (500)', 500));
    renderHook(() => useWorkspace('ws1'), { wrapper: retryingWrapper });

    await waitFor(() => expect(selectWorkspace.mock.calls.length).toBeGreaterThan(1));
  });
});
