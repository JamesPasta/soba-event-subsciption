'use client';

import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import type { WriteOutcome } from '@/src/shared/api/dataContracts';
import type { WorkspaceGroup } from '@/src/types/workspaceGroups';
import {
  createWorkspaceGroup,
  deleteWorkspaceGroup,
  renameWorkspaceGroup,
  setWorkspaceGroupRoles,
} from './api';
import { WORKSPACE_ACCESS_KEY } from './useWorkspaceAccess';
import { WORKSPACE_GROUPS_KEY } from './useWorkspaceGroups';

/** What the group form edits. */
export interface WorkspaceGroupFields {
  name: string;
  roleCodes: string[];
}

/** Role codes are unique within a set, so equal sizes and containment mean the same set. */
const sameRoles = (a: string[], b: string[]) =>
  a.length === b.length && a.every((code) => b.includes(code));

/**
 * Create, update or remove the workspace's groups. Each write re-reads the groups list and the
 * access list, whose rows carry group names.
 */
export function useWorkspaceGroupsWriter(workspaceId: string) {
  const { mutate } = useSWRConfig();
  const refresh = useCallback(
    () =>
      mutate(
        (key) =>
          Array.isArray(key) &&
          (key[0] === WORKSPACE_GROUPS_KEY || key[0] === WORKSPACE_ACCESS_KEY) &&
          key[1] === workspaceId,
      ),
    [mutate, workspaceId],
  );

  const create = useCallback(
    async (token: string, fields: WorkspaceGroupFields): Promise<WriteOutcome<void>> => {
      await createWorkspaceGroup(token, workspaceId, fields);
      await refresh();
      return { status: 'applied', value: undefined };
    },
    [workspaceId, refresh],
  );

  /**
   * Sends only what differs from `group`, the record the form was seeded with, so a save does not
   * carry this person's view of the other fields over an edit made elsewhere since.
   */
  const update = useCallback(
    async (
      token: string,
      group: WorkspaceGroup,
      fields: WorkspaceGroupFields,
    ): Promise<WriteOutcome<void>> => {
      try {
        if (fields.name !== group.name) {
          await renameWorkspaceGroup(token, workspaceId, group.id, { name: fields.name });
        }
        // A system group's roles are fixed; the API refuses the call.
        if (!group.system && !sameRoles(fields.roleCodes, group.roles)) {
          await setWorkspaceGroupRoles(token, workspaceId, group.id, fields.roleCodes);
        }
      } finally {
        await refresh();
      }
      return { status: 'applied', value: undefined };
    },
    [workspaceId, refresh],
  );

  const remove = useCallback(
    async (token: string, groupId: string): Promise<WriteOutcome<void>> => {
      await deleteWorkspaceGroup(token, workspaceId, groupId);
      await refresh();
      return { status: 'applied', value: undefined };
    },
    [workspaceId, refresh],
  );

  return { create, update, remove };
}
