'use client';

import { useCallback, useMemo } from 'react';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult } from '@/src/shared/api/dataContracts';
import type { WorkspaceRole } from '@/src/types/workspaceRoles';
import { listWorkspaceRoles } from './api';

/** Every roles key for the workspace starts with this, so a write can re-read them. */
export const WORKSPACE_ROLES_KEY = 'workspace-roles';

/** Every role available in the workspace. The server does not page them. */
export function useWorkspaceRoles(workspaceId: string): ListResult<WorkspaceRole> {
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    [WORKSPACE_ROLES_KEY, workspaceId],
    (token) => listWorkspaceRoles(token, workspaceId),
    listReadConfig,
  );

  const rows = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    rows,
    total: data?.items?.length,
    isLoading,
    isRefreshing: isValidating && data !== undefined,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}
