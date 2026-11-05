import type { ListWorkspaceRolesResponse } from '@soba/lib';
import { listPermissionCodesByRole, listRolesForWorkspace } from '../../db/repos/roleRepo';

export class RolesApiService {
  /** Includes the roles of switched-off features: a group can already hold one. */
  async list(workspaceId: string): Promise<ListWorkspaceRolesResponse> {
    const roles = await listRolesForWorkspace(workspaceId);
    const permissions = await listPermissionCodesByRole(roles.map((role) => role.code));
    return {
      items: roles.map((role) => ({
        roleCode: role.code,
        name: role.name,
        system: role.workspaceId === null,
        permissions: permissions.get(role.code) ?? [],
      })),
    };
  }
}

export const rolesApiService = new RolesApiService();
