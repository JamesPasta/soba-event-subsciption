import type { Dictionary } from '@/src/types/dictionary';

/** A role's name in the app language, else the catalog's own name, else its code. */
export function groupRoleLabel(dict: Dictionary, roleCode: string, catalogName?: string): string {
  const names: Partial<Record<string, string>> = dict.workspaces.groups.roleNames;
  return names[roleCode] ?? catalogName ?? roleCode;
}
