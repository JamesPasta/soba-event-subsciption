'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import type { RoleWithSourceMeta } from '@/src/types/workspaceGroups';
import { fetchRolesMeta } from './sobaApi';
import { sessionReadConfig } from './swrConfig';
import { classifyDataError } from './dataError';
import type { Resource } from './dataContracts';

/**
 * Every role a workspace group can carry, including those of features that are switched off: a
 * group can already hold one, and the group form shows only the roles listed here.
 */
export function useRolesMeta(): Resource<RoleWithSourceMeta[]> {
  const { data, isLoading, error, mutate } = useSWR(
    ['meta', 'roles'],
    () => fetchRolesMeta(false),
    sessionReadConfig,
  );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    data: data?.roles ?? null,
    isLoading,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}
