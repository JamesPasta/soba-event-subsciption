import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';

const searchUsers = vi.fn();
const fetchUserSearchCapabilities = vi.fn();
const createUserFromSearch = vi.fn();
vi.mock('@/src/features/user-search/data/api', () => ({
  searchUsers: (...args: unknown[]) => searchUsers(...args),
  fetchUserSearchCapabilities: (...args: unknown[]) => fetchUserSearchCapabilities(...args),
  createUserFromSearch: (...args: unknown[]) => createUserFromSearch(...args),
}));
const loadFeaturesMeta = vi.fn();
vi.mock('@/src/shared/config/featuresMeta', () => ({
  loadFeaturesMeta: () => loadFeaturesMeta(),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import {
  useUserFromSearchWriter,
  useUserSearch,
  useUserSearchAllowed,
  useUserSearchCapabilities,
} from '@/src/features/user-search/data/useUserSearch';
import type { UserSearchField, UserSearchResponse, UserSearchScope } from '@/src/types/userSearch';

const scope: UserSearchScope = { kind: 'form', id: 'form-1' };

const alice = {
  identityProvider: 'azureidir',
  subject: 'f0e1d2c3@azureidir',
  guid: 'F0E1D2C3',
  username: 'ASMITH',
  displayName: 'Smith, Alice CITZ:EX',
  firstName: 'Alice',
  lastName: 'Smith',
  email: 'alice@example.com',
  sobaUserId: null,
  sources: ['css-v1'],
};

let store: ReturnType<typeof makeStore>;

// Retries stay on, at a short interval, so a retry would show up within the test.
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryInterval: 1 }}>
        {children}
      </SWRConfig>
    </Provider>
  );
}

// Waits out the typing pause; the debounced term settles inside act.
const pastTypingPause = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });

describe('user search hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
  });

  it('reads what the scope can search, in the sort locale', async () => {
    fetchUserSearchCapabilities.mockResolvedValue({
      identityProviders: [{ code: 'azureidir', name: 'IDIR - MFA', fields: ['email'] }],
    });

    const { result } = renderHook(() => useUserSearchCapabilities(scope), { wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.identityProviders).toEqual([
      { code: 'azureidir', name: 'IDIR - MFA', fields: ['email'] },
    ]);
    expect(fetchUserSearchCapabilities).toHaveBeenCalledWith('token', scope, 'en');
  });

  it('searches the trimmed term on the chosen field once typing pauses', async () => {
    const response: UserSearchResponse = {
      users: [alice],
      truncated: true,
      plugins: [
        { code: 'css-v1', status: 'ok', truncated: true },
        { code: 'user-search-soba', status: 'unavailable', truncated: false },
      ],
    };
    searchUsers.mockResolvedValue(response);

    const { result } = renderHook(
      () => useUserSearch(scope, { field: 'lastName', term: ' Smith ' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.searched).toBe(true));
    expect(searchUsers).toHaveBeenCalledTimes(1);
    expect(searchUsers).toHaveBeenCalledWith('token', scope, { lastName: 'Smith' }, 'en');
    expect(result.current).toMatchObject({
      users: [alice],
      truncated: true,
      unavailable: ['user-search-soba'],
      error: null,
    });
  });

  it('sends nothing for a short term', async () => {
    const { result } = renderHook(() => useUserSearch(scope, { field: 'email', term: ' a ' }), {
      wrapper,
    });

    await pastTypingPause();

    expect(searchUsers).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ users: [], searched: false, error: null });
  });

  describe('after a search on one field', () => {
    const search = async () => {
      searchUsers.mockResolvedValueOnce({ users: [alice], truncated: false, plugins: [] });
      const hook = renderHook(
        ({ field, term }: { field: UserSearchField; term: string }) =>
          useUserSearch(scope, { field, term }),
        { wrapper, initialProps: { field: 'lastName', term: 'Smith' } },
      );
      await waitFor(() => expect(hook.result.current.searched).toBe(true));
      return hook;
    };
    const queries = () => searchUsers.mock.calls.map((call) => call[2]);

    it('never searches the previous term on another field', async () => {
      searchUsers.mockResolvedValue({ users: [], truncated: false, plugins: [] });
      const { rerender } = await search();

      // Another field clears the input, and a new term is typed before the pause ends.
      rerender({ field: 'firstName', term: '' });
      rerender({ field: 'firstName', term: 'Al' });
      await pastTypingPause();

      await waitFor(() => expect(searchUsers).toHaveBeenCalledTimes(2));
      expect(queries()).toEqual([{ lastName: 'Smith' }, { firstName: 'Al' }]);
    });

    it('drops those people while another field is searched', async () => {
      searchUsers.mockReturnValue(new Promise(() => {}));
      const { result, rerender } = await search();

      rerender({ field: 'firstName', term: 'Al' });
      await pastTypingPause();

      await waitFor(() => expect(result.current.isSearching).toBe(true));
      expect(result.current).toMatchObject({ users: [], searched: false });
    });

    it('keeps those people while a longer term on the same field is searched', async () => {
      searchUsers.mockReturnValue(new Promise(() => {}));
      const { result, rerender } = await search();

      rerender({ field: 'lastName', term: 'Smithe' });
      await pastTypingPause();

      await waitFor(() => expect(result.current.isSearching).toBe(true));
      expect(result.current).toMatchObject({ users: [alice], searched: true });
    });

    it('drops those people when the next search fails', async () => {
      searchUsers.mockRejectedValue(new ApiError('User search is unavailable', 503));
      const { result, rerender } = await search();

      rerender({ field: 'lastName', term: 'Smithe' });
      await pastTypingPause();

      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current).toMatchObject({ users: [], searched: false });
    });
  });

  it('reports a refused or unavailable search without retrying it', async () => {
    searchUsers.mockRejectedValue(new ApiError('User search is unavailable', 503));

    const { result } = renderHook(() => useUserSearch(scope, { field: 'email', term: 'al' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.kind).toBe('failed');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(searchUsers).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['allowed on the platform and in this app', true, 'user-search', true],
    ['disabled on the platform', false, 'user-search', false],
    ['left out of this app', true, 'design-mode', false],
  ])('allows search only when %s', async (_case, platformAllowed, appAllowed, expected) => {
    window.__SOBA_FEATURES_ALLOWED = appAllowed;
    loadFeaturesMeta.mockResolvedValue({
      features: [{ code: 'user-search', platformAllowed, availability: 'fixed' }],
    });
    try {
      const { result } = renderHook(() => useUserSearchAllowed(), { wrapper });
      await waitFor(() => expect(result.current).toBe(expected));
    } finally {
      delete window.__SOBA_FEATURES_ALLOWED;
    }
  });

  it('treats a failed feature list as not allowed', async () => {
    loadFeaturesMeta.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useUserSearchAllowed(), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('reads a search on screen again after making a user, and not what can be searched', async () => {
    fetchUserSearchCapabilities.mockResolvedValue({ identityProviders: [] });
    searchUsers.mockResolvedValue({ users: [alice], truncated: false, plugins: [] });
    createUserFromSearch.mockResolvedValue({ userId: 'user-made', created: true });
    const { result } = renderHook(
      () => ({
        search: useUserSearch(scope, { field: 'email', term: 'alice' }),
        capabilities: useUserSearchCapabilities(scope),
        writer: useUserFromSearchWriter(scope),
      }),
      { wrapper },
    );
    await pastTypingPause();
    await waitFor(() => expect(result.current.search.users).toHaveLength(1));
    await waitFor(() => expect(result.current.capabilities.loaded).toBe(true));
    const capabilityReads = fetchUserSearchCapabilities.mock.calls.length;
    searchUsers.mockResolvedValue({
      users: [{ ...alice, sobaUserId: 'user-made' }],
      truncated: false,
      plugins: [],
    });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.writer.create('token', {
        identityProvider: 'azureidir',
        guid: 'F0E1D2C3',
      });
    });

    expect(outcome).toEqual({ status: 'applied', value: { userId: 'user-made', created: true } });
    expect(createUserFromSearch).toHaveBeenCalledWith('token', scope, {
      identityProvider: 'azureidir',
      guid: 'F0E1D2C3',
    });
    await waitFor(() => expect(result.current.search.users[0]?.sobaUserId).toBe('user-made'));
    expect(fetchUserSearchCapabilities).toHaveBeenCalledTimes(capabilityReads);
  });

  it('clears a search no one is showing after making a user, so it is not shown stale', async () => {
    const cache = new Map();
    const shared = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
      </Provider>
    );
    searchUsers.mockResolvedValue({ users: [alice], truncated: false, plugins: [] });
    const first = renderHook(() => useUserSearch(scope, { field: 'email', term: 'alice' }), {
      wrapper: shared,
    });
    await pastTypingPause();
    await waitFor(() => expect(first.result.current.users).toHaveLength(1));
    first.unmount();

    createUserFromSearch.mockResolvedValue({ userId: 'user-made', created: true });
    const writer = renderHook(() => useUserFromSearchWriter(scope), { wrapper: shared });
    await act(async () => {
      await writer.result.current.create('token', {
        identityProvider: 'azureidir',
        guid: 'F0E1D2C3',
      });
    });

    searchUsers.mockReturnValue(new Promise(() => undefined));
    const again = renderHook(() => useUserSearch(scope, { field: 'email', term: 'alice' }), {
      wrapper: shared,
    });
    await pastTypingPause();
    expect(again.result.current.users).toEqual([]);
  });
});
