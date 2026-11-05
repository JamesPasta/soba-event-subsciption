import {
  ApiErrorCodes,
  type CreateWorkspaceRoleBody,
  type ListWorkspaceRolesResponse,
  type UpdateWorkspaceRoleBody,
  type WorkspaceRole,
} from '@soba/lib';
import { ConflictError, NotFoundError } from '../../errors';
import { ROLE_NAME_TAKEN, ROLE_NOT_FOUND } from '../../messages';
import {
  createWorkspaceRole,
  listPermissionCodesByRole,
  listRolesForWorkspace,
  roleNameExistsInWorkspace,
  softDeleteWorkspaceRole,
  updateWorkspaceRole,
  type RoleRow,
  type RoleWriteContext,
} from '../../db/repos/roleRepo';

const toWorkspaceRoles = async (roles: RoleRow[]): Promise<WorkspaceRole[]> => {
  const permissions = await listPermissionCodesByRole(roles.map((role) => role.code));
  return roles.map((role) => ({
    roleCode: role.code,
    name: role.name,
    system: role.workspaceId === null,
    permissions: permissions.get(role.code) ?? [],
  }));
};

/** Rejects a name already taken by one of the workspace's active roles. */
async function assertNameFree(workspaceId: string, name: string): Promise<void> {
  if (await roleNameExistsInWorkspace(workspaceId, name)) {
    throw new ConflictError(ROLE_NAME_TAKEN, ApiErrorCodes.role_name_taken);
  }
}

export class RolesApiService {
  /** Includes the roles of switched-off features: a group can already hold one. */
  async list(workspaceId: string): Promise<ListWorkspaceRolesResponse> {
    return { items: await toWorkspaceRoles(await listRolesForWorkspace(workspaceId)) };
  }

  async get(workspaceId: string, roleCode: string): Promise<WorkspaceRole> {
    const [role] = await toWorkspaceRoles(await listRolesForWorkspace(workspaceId, [roleCode]));
    if (!role) throw new NotFoundError(ROLE_NOT_FOUND);
    return role;
  }

  async create(ctx: RoleWriteContext, body: CreateWorkspaceRoleBody): Promise<WorkspaceRole> {
    await assertNameFree(ctx.workspaceId, body.name);
    return this.get(ctx.workspaceId, await createWorkspaceRole(ctx, body));
  }

  /** The write checks the role is the workspace's own before it checks the name. */
  async update(
    ctx: RoleWriteContext,
    roleCode: string,
    body: UpdateWorkspaceRoleBody,
  ): Promise<WorkspaceRole> {
    await updateWorkspaceRole(ctx, roleCode, body);
    return this.get(ctx.workspaceId, roleCode);
  }

  remove(ctx: RoleWriteContext, roleCode: string): Promise<void> {
    return softDeleteWorkspaceRole(ctx, roleCode);
  }
}

export const rolesApiService = new RolesApiService();
