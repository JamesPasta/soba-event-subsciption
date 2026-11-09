'use client';

import { useCallback, useMemo } from 'react';
import useSWR, { useSWRConfig, type SWRConfiguration } from 'swr';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError, isSessionExpired } from '@/src/shared/api/dataError';
import type { WriteOutcome } from '@/src/shared/api/dataContracts';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { loadFeaturesMeta } from '@/src/shared/config/featuresMeta';
import { createIsFeatureAllowed, FEATURE_CODES } from '@/src/shared/featureFlags/flags';
import { useDebouncedValue } from '@/src/shared/hooks/useDebouncedValue';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import type {
  CreateUserFromSearchResponse,
  UserSearchCapabilitiesResponse,
  UserSearchField,
  UserSearchIdentityProvider,
  UserSearchResponse,
  UserSearchScope,
  UserSearchUser,
} from '@/src/types/userSearch';
import { createUserFromSearch, fetchUserSearchCapabilities, searchUsers } from './api';

/** The shortest term a search is sent for; the API refuses shorter ones. */
export const USER_SEARCH_MIN_LENGTH = 2;
const TYPING_PAUSE_MS = 300;

/** Every user search key starts with this, so a write can re-read a scope's searches. */
const USER_SEARCH_KEY = 'user-search';

const EMPTY_PROVIDERS: UserSearchIdentityProvider[] = [];
const EMPTY_USERS: UserSearchUser[] = [];
const EMPTY_CODES: string[] = [];

/** Every answer from the API is final: a refusal or an unavailable directory repeats on retry. */
const retryOnlyWithoutAnswer = (err: unknown) =>
  !isSessionExpired(err) && !(err instanceof ApiError);

const capabilitiesReadConfig: SWRConfiguration = {
  ...sessionReadConfig,
  shouldRetryOnError: retryOnlyWithoutAnswer,
};

const searchReadConfig: SWRConfiguration = {
  keepPreviousData: true,
  shouldRetryOnError: retryOnlyWithoutAnswer,
};

const isUserSearchAllowed = () =>
  loadFeaturesMeta().then(
    (meta) => createIsFeatureAllowed(meta)(FEATURE_CODES.USER_SEARCH),
    () => false,
  );

/** Whether this app offers user search: null until the feature list loads, false if it fails. */
export function useUserSearchAllowed(): boolean | null {
  const { data } = useSWR(
    ['feature-allowed', FEATURE_CODES.USER_SEARCH],
    isUserSearchAllowed,
    sessionReadConfig,
  );
  return data ?? null;
}

/** The identity providers searchable in the scope, each with the filters it accepts. */
export function useUserSearchCapabilities(scope: UserSearchScope | null) {
  const locale = useSortLocale();
  const { data, isLoading, error } = useAuthedSWR<UserSearchCapabilitiesResponse>(
    scope ? [USER_SEARCH_KEY, 'capabilities', scope.kind, scope.id, locale] : null,
    (token) => fetchUserSearchCapabilities(token, scope as UserSearchScope, locale),
    capabilitiesReadConfig,
  );
  return {
    identityProviders: data?.identityProviders ?? EMPTY_PROVIDERS,
    loaded: data !== undefined,
    isLoading,
    error: error ? classifyDataError(error) : null,
  };
}

export interface UserSearchInput {
  field: UserSearchField;
  term: string;
}

/** A search's answer, with the field it searched. */
interface FieldAnswer {
  field: UserSearchField;
  response: UserSearchResponse;
}

/**
 * People matching `term` on `field` in every identity provider searchable in the scope, searched
 * once typing pauses. Nothing is sent for a term shorter than USER_SEARCH_MIN_LENGTH.
 */
export function useUserSearch(scope: UserSearchScope | null, input: UserSearchInput) {
  const locale = useSortLocale();
  const { field } = input;
  const typed = input.term.trim();
  const typedSearch = useMemo(() => ({ field, term: typed }), [field, typed]);
  const settled = useDebouncedValue(typedSearch, TYPING_PAUSE_MS);
  // What is typed now counts too: a cleared input or another field stops the search at once.
  const key =
    scope &&
    settled.field === field &&
    typed.length >= USER_SEARCH_MIN_LENGTH &&
    settled.term.length >= USER_SEARCH_MIN_LENGTH
      ? [USER_SEARCH_KEY, scope.kind, scope.id, settled.field, settled.term, locale]
      : null;
  const ready = key !== null;
  const { data, isValidating, error } = useAuthedSWR<FieldAnswer>(
    key,
    async (token) => ({
      field: settled.field,
      response: await searchUsers(
        token,
        scope as UserSearchScope,
        { [settled.field]: settled.term },
        locale,
      ),
    }),
    searchReadConfig,
  );
  // People from an earlier term on this field stay listed while the next one is searched; people
  // found by another field, or kept past a failed search, do not.
  const current = ready && !error && data?.field === field ? data.response : undefined;
  const plugins = current?.plugins ?? [];
  return {
    users: current?.users ?? EMPTY_USERS,
    truncated: current?.truncated === true,
    /** Plugins that could not answer, so the people listed may be incomplete. */
    unavailable: plugins.length
      ? plugins.filter(({ status }) => status === 'unavailable').map(({ code }) => code)
      : EMPTY_CODES,
    searched: current !== undefined,
    isSearching: ready && isValidating,
    error: ready && error ? classifyDataError(error) : null,
  };
}

/**
 * Makes the Soba user for a person found by search in the scope. Every stored search is cleared
 * and read again afterwards, so the person shows as an existing user wherever they were found.
 */
export function useUserFromSearchWriter({ kind, id }: UserSearchScope) {
  const { mutate } = useSWRConfig();
  const create = useCallback(
    async (
      token: string,
      person: { identityProvider: string; guid: string },
    ): Promise<WriteOutcome<CreateUserFromSearchResponse>> => {
      const result = await createUserFromSearch(token, { kind, id }, person);
      // Cleared, not only revalidated: a search no picker is showing keeps its data otherwise.
      await mutate(
        (key) => Array.isArray(key) && key[0] === USER_SEARCH_KEY && key[1] !== 'capabilities',
        undefined,
        { revalidate: true },
      );
      return { status: 'applied', value: result };
    },
    [kind, id, mutate],
  );
  return { create };
}
