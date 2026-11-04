import type { ListWorkspaceRolesResponse } from '@soba/lib';
import { listPermissionCodesByRole, listRoles } from '../../db/repos/roleRepo';

export class RolesApiService {
  /** Includes the roles of switched-off features: a group can already hold one. */
  async list(): Promise<ListWorkspaceRolesResponse> {
    const roles = await listRoles({ onlyEnabledFeatures: false });
    const permissions = await listPermissionCodesByRole(roles.map((role) => role.code));
    return {
      items: roles.map((role) => ({
        roleCode: role.code,
        name: role.name,
        system: true,
        permissions: permissions.get(role.code) ?? [],
      })),
    };
  }
}

export const rolesApiService = new RolesApiService();
