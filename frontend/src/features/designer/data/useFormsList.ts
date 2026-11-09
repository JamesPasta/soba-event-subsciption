'use client';

import { useCallback, useMemo } from 'react';
import { getSobaForms } from '@/src/shared/api/sobaApi';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult } from '@/src/shared/api/dataContracts';
import type { ListQueryArgs } from '@/src/types/list';
import type { SobaFormSummary } from '@/src/types/forms';
import { useSortLocale } from '@/src/shared/list/useSortLocale';

const EMPTY: SobaFormSummary[] = [];

/**
 * One page of forms, optionally scoped to a workspace. `holdRequest` waits for the workspace filter
 * to resolve, so the first arrival does not read unscoped.
 */
export function useFormsList(
  query: ListQueryArgs,
  workspaceId: string | undefined,
  holdRequest: boolean,
): ListResult<SobaFormSummary> {
  const locale = useSortLocale();
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    holdRequest
      ? null
      : ['forms', workspaceId ?? null, query.offset, query.limit, query.sort, query.q, locale],
    (token) =>
      getSobaForms(token, {
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
        q: query.q,
        locale,
        workspaceId,
      }),
    listReadConfig,
  );

  const rows: SobaFormSummary[] = useMemo(
    () => (Array.isArray(data?.items) ? data.items : EMPTY),
    [data],
  );
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    rows,
    total: data?.page?.total,
    isLoading,
    isRefreshing: isValidating && data !== undefined,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}
