'use client';

import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import type { WriteOutcome } from '@/src/shared/api/dataContracts';
import type { AssignablePermissionCode } from '@/src/types/permissions';
import type { UpdateWorkspaceRoleBody, WorkspaceRole } from '@/src/types/workspaceRoles';
import { createWorkspaceRole, deleteWorkspaceRole, updateWorkspaceRole } from './api';
import { WORKSPACE_ROLES_KEY } from './useWorkspaceRoles';

/** What the role form edits. */
export interface WorkspaceRoleFields {
  name: string;
  permissionCodes: string[];
}

/** Permission codes are unique within a set, so equal sizes and containment mean the same set. */
const samePermissions = (a: string[], b: string[]) =>
  a.length === b.length && a.every((code) => b.includes(code));

/** Create, update or remove the workspace's own roles. Each write re-reads the roles list. */
export function useWorkspaceRolesWriter(workspaceId: string) {
  const { mutate } = useSWRConfig();
  const refresh = useCallback(
    () =>
      mutate(
        (key) => Array.isArray(key) && key[0] === WORKSPACE_ROLES_KEY && key[1] === workspaceId,
      ),
    [mutate, workspaceId],
  );

  const create = useCallback(
    async (token: string, fields: WorkspaceRoleFields): Promise<WriteOutcome<void>> => {
      try {
        await createWorkspaceRole(token, workspaceId, {
          name: fields.name,
          permissionCodes: fields.permissionCodes as AssignablePermissionCode[],
        });
      } finally {
        await refresh();
      }
      return { status: 'applied', value: undefined };
    },
    [workspaceId, refresh],
  );

  /**
   * Sends only what differs from `role`, the record the form was seeded with, so a save does not
   * carry this person's view of the other field over an edit made elsewhere since.
   */
  const update = useCallback(
    async (
      token: string,
      role: WorkspaceRole,
      fields: WorkspaceRoleFields,
    ): Promise<WriteOutcome<void>> => {
      const changes: UpdateWorkspaceRoleBody = {};
      if (fields.name !== role.name) changes.name = fields.name;
      if (!samePermissions(fields.permissionCodes, role.permissions)) {
        changes.permissionCodes = fields.permissionCodes as AssignablePermissionCode[];
      }
      if (!Object.keys(changes).length) return { status: 'applied', value: undefined };
      try {
        await updateWorkspaceRole(token, workspaceId, role.roleCode, changes);
      } finally {
        await refresh();
      }
      return { status: 'applied', value: undefined };
    },
    [workspaceId, refresh],
  );

  const remove = useCallback(
    async (token: string, roleCode: string): Promise<WriteOutcome<void>> => {
      try {
        await deleteWorkspaceRole(token, workspaceId, roleCode);
      } finally {
        await refresh();
      }
      return { status: 'applied', value: undefined };
    },
    [workspaceId, refresh],
  );

  return { create, update, remove };
}
