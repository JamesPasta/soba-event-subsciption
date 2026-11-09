import { compareTextForSort, type SortDirection, type SortLocale } from '@soba/lib/sort';
import type { Dictionary } from '@/src/types/dictionary';
import type { WorkspaceRole } from '@/src/types/workspaceRoles';

/** A role's name in the app language, else the catalog's own name, else its code. */
export function groupRoleLabel(dict: Dictionary, roleCode: string, catalogName?: string): string {
  const names: Partial<Record<string, string>> = dict.workspaces.groups.roleNames;
  return names[roleCode] ?? catalogName ?? roleCode;
}

/** A role's label where fixed and custom roles are listed together: a custom role says it is one. */
export function assignableRoleLabel(dict: Dictionary, role: WorkspaceRole): string {
  const label = groupRoleLabel(dict, role.roleCode, role.name);
  return role.system ? label : dict.workspaces.groups.customRoleName.replace('{name}', label);
}

/** The roles in the order of the names shown: fixed roles have dictionary names the server lacks. */
export function rolesByLabel(
  dict: Dictionary,
  roles: readonly WorkspaceRole[],
  locale: SortLocale,
  direction: SortDirection = 'asc',
): WorkspaceRole[] {
  const label = (role: WorkspaceRole) => groupRoleLabel(dict, role.roleCode, role.name);
  return [...roles].sort((a, b) =>
    compareTextForSort(label(a), label(b), direction, locale, { linguistic: true }),
  );
}
