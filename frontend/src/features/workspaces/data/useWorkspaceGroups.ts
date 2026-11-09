'use client';

import { useCallback, useMemo } from 'react';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult } from '@/src/shared/api/dataContracts';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import type { ListQueryArgs } from '@/src/types/list';
import type { WorkspaceGroup } from '@/src/types/workspaceGroups';
import { listWorkspaceGroups } from './api';

/** Every groups-list key for the workspace starts with this, so a write can re-read them all. */
export const WORKSPACE_GROUPS_KEY = 'workspace-groups';

/** One page of the workspace's groups. */
export function useWorkspaceGroups(
  workspaceId: string,
  query: ListQueryArgs,
): ListResult<WorkspaceGroup> {
  const locale = useSortLocale();
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    [
      WORKSPACE_GROUPS_KEY,
      workspaceId,
      query.offset,
      query.limit,
      query.sort,
      query.q ?? '',
      locale,
    ],
    (token) => listWorkspaceGroups(token, workspaceId, { ...query, locale }),
    listReadConfig,
  );

  const rows = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);
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
