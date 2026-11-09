'use client';

import { useCallback, useMemo } from 'react';
import { API_KEY_SETTINGS_KEY } from '@soba/lib';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult } from '@/src/shared/api/dataContracts';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import type { CredentialMetadata, CredentialOwner } from '@/src/types/credentials';
import type { ListQueryArgs } from '@/src/types/list';
import { listCredentials } from './api';

/**
 * One page of the owner's API keys, plus whether keys can be generated. Holds metadata only: a key
 * is returned to the form that asked for it and never enters the cache.
 */
export function useCredentials(
  owner: CredentialOwner,
  query: ListQueryArgs,
): ListResult<CredentialMetadata> & { available: boolean | undefined } {
  const locale = useSortLocale();
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    [
      API_KEY_SETTINGS_KEY,
      owner.kind,
      owner.id,
      query.offset,
      query.limit,
      query.sort,
      query.q ?? '',
      locale,
    ],
    (token) => listCredentials(token, owner, { ...query, locale }),
    listReadConfig,
  );

  const rows = useMemo(() => data?.items ?? [], [data]);
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    rows,
    total: data?.page.total,
    available: data?.available,
    isLoading,
    isRefreshing: isValidating && data !== undefined,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}
