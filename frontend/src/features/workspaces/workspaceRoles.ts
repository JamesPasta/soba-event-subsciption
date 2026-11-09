/** Membership roles allowed to manage workspaces. */
export const WORKSPACE_MANAGE_ROLES = ['owner', 'admin'] as const;

export function isWorkspaceManageRole(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/** The owner role alone. */
export function isWorkspaceOwnerRole(role: string): boolean {
  return role === 'owner';
}
