'use client';

import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import type { WriteOutcome } from '@/src/shared/api/dataContracts';
import { addWorkspaceAccess, removeWorkspaceAccess, setWorkspaceAccessGroups } from './accessApi';
import { WORKSPACE_ACCESS_KEY } from './useWorkspaceAccess';
import { WORKSPACE_GROUPS_KEY } from './useWorkspaceGroups';

/**
 * Add, regroup or remove the workspace's members. Each write re-reads the access list and the
 * groups list, whose rows carry their members.
 */
export function useWorkspaceAccessWriter(workspaceId: string) {
  const { mutate } = useSWRConfig();
  const refresh = useCallback(
    () =>
      mutate(
        (key) =>
          Array.isArray(key) &&
          (key[0] === WORKSPACE_ACCESS_KEY || key[0] === WORKSPACE_GROUPS_KEY) &&
          key[1] === workspaceId,
      ),
    [mutate, workspaceId],
  );

  const add = useCallback(
    async (token: string, userId: string, groupIds: string[]): Promise<WriteOutcome<void>> => {
      await addWorkspaceAccess(token, workspaceId, { userId, groupIds });
      await refresh();
      return { status: 'applied', value: undefined };
    },
    [workspaceId, refresh],
  );

  const setGroups = useCallback(
    async (
      token: string,
      membershipId: string,
      groupIds: string[],
    ): Promise<WriteOutcome<void>> => {
      await setWorkspaceAccessGroups(token, workspaceId, membershipId, groupIds);
      await refresh();
      return { status: 'applied', value: undefined };
    },
    [workspaceId, refresh],
  );

  const remove = useCallback(
    async (token: string, membershipId: string): Promise<WriteOutcome<void>> => {
      await removeWorkspaceAccess(token, workspaceId, membershipId);
      await refresh();
      return { status: 'applied', value: undefined };
    },
    [workspaceId, refresh],
  );

  return { add, setGroups, remove };
}
