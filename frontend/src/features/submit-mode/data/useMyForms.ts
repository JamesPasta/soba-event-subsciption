'use client';

import { useCallback, useMemo } from 'react';
import { getMyForms, getMyWorkspaces } from '@/src/shared/api/sobaApi';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult } from '@/src/shared/api/dataContracts';
import type { ListQueryArgs } from '@/src/types/list';
import type { MyFormListItem } from '@/src/types/forms';
import type { MyWorkspaceLookupItem } from '@/src/types/workspaces';
import { useSortLocale } from '@/src/shared/list/useSortLocale';

const KEY = 'my-forms';
const EMPTY: MyFormListItem[] = [];
const EMPTY_OPTIONS: MyWorkspaceLookupItem[] = [];

/**
 * One page of the forms the caller holds the submitter role on or has submitted to, optionally in
 * one workspace.
 * `holdRequest` waits for the workspace filter to resolve.
 */
export function useMyForms(
  query: ListQueryArgs,
  workspaceId: string | undefined,
  holdRequest: boolean,
): ListResult<MyFormListItem> {
  const locale = useSortLocale();
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    holdRequest
      ? null
      : [KEY, query.offset, query.limit, query.sort, query.q ?? '', workspaceId ?? '', locale],
    (token) =>
      getMyForms(token, {
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
        q: query.q,
        locale,
        workspaceId,
      }),
    listReadConfig,
  );

  const rows: MyFormListItem[] = useMemo(
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

/** Options for the My Forms workspace filter. Stops at the lookup limit. */
export function useMyWorkspaceOptions() {
  const locale = useSortLocale();
  const { data, error } = useAuthedSWR([KEY, 'workspaces', locale], (token) =>
    getMyWorkspaces(token, locale),
  );
  return {
    workspaces: Array.isArray(data?.items) ? data.items : EMPTY_OPTIONS,
    truncated: data?.truncated === true,
    limit: data?.limit,
    loaded: data !== undefined,
    error: error ? classifyDataError(error) : null,
  };
}
