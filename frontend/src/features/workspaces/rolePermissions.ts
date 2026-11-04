import type { Dictionary } from '@/src/types/dictionary';
import { Permissions, type PermissionCode } from '@/src/types/permissions';

type PermissionArea = keyof Dictionary['workspaces']['roles']['areas'];

/** Every permission a role can list except the wildcard, by area in display order. */
export const PERMISSION_AREAS: readonly { area: PermissionArea; codes: PermissionCode[] }[] = [
  {
    area: 'forms',
    codes: [
      Permissions.form_create,
      Permissions.form_read,
      Permissions.form_update,
      Permissions.form_delete,
    ],
  },
  {
    area: 'designs',
    codes: [
      Permissions.design_create,
      Permissions.design_read,
      Permissions.design_update,
      Permissions.design_delete,
    ],
  },
  {
    area: 'submissions',
    codes: [
      Permissions.submission_create,
      Permissions.submission_read,
      Permissions.submission_update,
      Permissions.submission_delete,
      Permissions.submission_review,
      Permissions.submission_print_upload,
    ],
  },
  {
    area: 'team',
    codes: [Permissions.team_read, Permissions.team_update],
  },
  {
    area: 'documentTemplates',
    codes: [
      Permissions.document_template_create,
      Permissions.document_template_read,
      Permissions.document_template_delete,
    ],
  },
];

/** A permission's name in the app language, else its code. */
export function permissionLabel(dict: Dictionary, code: string): string {
  const names: Partial<Record<string, string>> = dict.workspaces.roles.permissionNames;
  return names[code] ?? code;
}

/** Whether the permissions include the wildcard, which grants every permission. */
export const grantsAllPermissions = (permissions: readonly string[]): boolean =>
  permissions.includes(Permissions.all);
