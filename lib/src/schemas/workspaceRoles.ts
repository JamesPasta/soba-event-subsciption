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

const PermissionCodesSchema = z
  .array(z.enum(AssignablePermissions as [AssignablePermissionCode, ...AssignablePermissionCode[]]))
  .min(1);

export const CreateWorkspaceRoleBodySchema = z.object({
  name: z.string().trim().min(1),
  permissionCodes: PermissionCodesSchema,
});
export type CreateWorkspaceRoleBody = z.infer<typeof CreateWorkspaceRoleBodySchema>;

export const UpdateWorkspaceRoleBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    permissionCodes: PermissionCodesSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.permissionCodes !== undefined, {
    message: 'Provide a name or permission codes to update',
  });
export type UpdateWorkspaceRoleBody = z.infer<typeof UpdateWorkspaceRoleBodySchema>;
