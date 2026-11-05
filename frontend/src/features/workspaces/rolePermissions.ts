import type { Dictionary } from '@/src/types/dictionary';
import { Permissions, type AssignablePermissionCode as Code } from '@/src/types/permissions';

type PermissionArea = keyof Dictionary['workspaces']['roles']['areas'];

/** Every permission a role can list except the wildcard, by area in display order. */
export const PERMISSION_AREAS: readonly { area: PermissionArea; codes: Code[] }[] = [
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

/**
 * What each permission needs for the screens and routes it opens to work. Advice for the picker
 * only: groups stack roles, so a role may leave one out on purpose. submission_create and
 * document_template_read need nothing, because submitting does not go through form_read.
 */
const NEEDS: Partial<Record<string, readonly Code[]>> = {
  [Permissions.form_create]: [Permissions.form_read, Permissions.design_create],
  [Permissions.form_update]: [Permissions.form_read],
  [Permissions.form_delete]: [Permissions.form_read],
  [Permissions.design_create]: [Permissions.form_read, Permissions.design_update],
  [Permissions.design_read]: [Permissions.form_read],
  [Permissions.design_update]: [Permissions.form_read, Permissions.design_create],
  [Permissions.design_delete]: [Permissions.form_read],
  [Permissions.submission_read]: [Permissions.form_read],
  [Permissions.submission_update]: [Permissions.submission_read],
  [Permissions.submission_delete]: [Permissions.submission_read],
  [Permissions.submission_review]: [Permissions.submission_read],
  [Permissions.submission_print_upload]: [Permissions.submission_read],
  [Permissions.team_read]: [Permissions.form_read],
  [Permissions.team_update]: [Permissions.team_read],
  [Permissions.document_template_create]: [
    Permissions.form_read,
    Permissions.document_template_read,
  ],
  [Permissions.document_template_delete]: [
    Permissions.form_read,
    Permissions.document_template_read,
  ],
};

/** `next`, plus what each newly ticked permission needs. Unticking touches nothing else. */
export function withNeededPermissions(
  previous: readonly string[],
  next: readonly string[],
): string[] {
  const result = new Set(next);
  const pending = next.filter((code) => !previous.includes(code));
  for (let code = pending.pop(); code !== undefined; code = pending.pop()) {
    for (const needed of NEEDS[code] ?? []) {
      if (!result.has(needed)) {
        result.add(needed);
        pending.push(needed);
      }
    }
  }
  return [...result];
}

/** A permission's name in the app language, else its code. */
export function permissionLabel(dict: Dictionary, code: string): string {
  const names: Partial<Record<string, string>> = dict.workspaces.roles.permissionNames;
  return names[code] ?? code;
}

/** Whether the permissions include the wildcard, which grants every permission. */
export const grantsAllPermissions = (permissions: readonly string[]): boolean =>
  permissions.includes(Permissions.all);
