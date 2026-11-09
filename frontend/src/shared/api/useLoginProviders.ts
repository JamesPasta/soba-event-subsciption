'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import type { LoginProviderMeta } from '@/src/types/formSettings';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import { fetchLoginProviders } from './sobaApi';
import { sessionReadConfig } from './swrConfig';
import { classifyDataError } from './dataError';
import type { Resource } from './dataContracts';

/** The providers an audience can name, by name in the app language. */
export function useLoginProviders(): Resource<LoginProviderMeta[]> {
  const locale = useSortLocale();
  const { data, isLoading, error, mutate } = useSWR(
    ['meta', 'login-providers', locale],
    () => fetchLoginProviders(locale),
    sessionReadConfig,
  );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    data: data?.items ?? null,
    isLoading,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}
