'use client';

import { useCallback, useMemo } from 'react';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult } from '@/src/shared/api/dataContracts';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import type { ListQueryArgs } from '@/src/types/list';
import type { WorkspaceAccessInclude, WorkspaceAccessMember } from '@/src/types/workspaceAccess';
import { listWorkspaceAccess } from './accessApi';

/** Every access-list key for the workspace starts with this, so a write can re-read them all. */
export const WORKSPACE_ACCESS_KEY = 'workspace-access';

/** One page of the workspace's members with their groups. */
export function useWorkspaceAccess(
  workspaceId: string,
  query: ListQueryArgs & { include: WorkspaceAccessInclude },
): ListResult<WorkspaceAccessMember> {
  const locale = useSortLocale();
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    [
      WORKSPACE_ACCESS_KEY,
      workspaceId,
      query.include,
      query.offset,
      query.limit,
      query.sort,
      query.q ?? '',
      locale,
    ],
    (token) => listWorkspaceAccess(token, workspaceId, { ...query, locale }),
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
