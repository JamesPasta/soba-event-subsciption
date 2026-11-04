import { z } from 'zod';

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
