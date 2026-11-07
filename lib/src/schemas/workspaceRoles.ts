import { z } from 'zod';
import { AssignablePermissions, type AssignablePermissionCode } from '../permissions/codes';

/** A role available in a workspace, with the permission codes it grants. */
export const WorkspaceRoleSchema = z.object({
  roleCode: z.string(),
  name: z.string(),
  /** True for the platform's fixed roles, which can't be changed. */
  system: z.boolean(),
  permissions: z.array(z.string()),
});
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const ListWorkspaceRolesResponseSchema = z.object({
  items: z.array(WorkspaceRoleSchema),
});
export type ListWorkspaceRolesResponse = z.infer<typeof ListWorkspaceRolesResponseSchema>;

export const WORKSPACE_ROLE_NAME_MAX_LENGTH = 100;

const RoleNameSchema = z.string().trim().min(1).max(WORKSPACE_ROLE_NAME_MAX_LENGTH);

const PermissionCodesSchema = z
  .array(z.enum(AssignablePermissions as [AssignablePermissionCode, ...AssignablePermissionCode[]]))
  .min(1);

export const CreateWorkspaceRoleBodySchema = z.object({
  name: RoleNameSchema,
  permissionCodes: PermissionCodesSchema,
});
export type CreateWorkspaceRoleBody = z.infer<typeof CreateWorkspaceRoleBodySchema>;

export const UpdateWorkspaceRoleBodySchema = z
  .object({
    name: RoleNameSchema.optional(),
    permissionCodes: PermissionCodesSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.permissionCodes !== undefined, {
    message: 'Provide a name or permission codes to update',
  });
export type UpdateWorkspaceRoleBody = z.infer<typeof UpdateWorkspaceRoleBodySchema>;
