import { formAccessAllows } from '@soba/lib';
import { PUBLIC_PROVIDER_CODE } from '../codes';
import type { PermissionCode } from '../codes';
import { findSubmitterFormFacts } from './submitterFormRepo';

/** The identity of a caller on the public read/submit paths (the public user for anonymous). */
export interface CallerIdentity {
  /** Resolved app_user id (the seeded public user for anonymous callers). */
  actorId?: string | null;
  /** The caller's identity provider code (lowercased); `public` for anonymous. */
  idpCode?: string | null;
}

/** The form an access check is for, with the workspace that owns it. */
export interface FormAccessTarget {
  workspaceId: string;
  formId: string;
}

/**
 * Authorizes a caller for `required` on a form, by formAccessAllows over the form's facts: the
 * roles of the groups the caller is an effective member of, or, for an audience permission, the
 * form's audience.
 */
export const hasFormSubmitAccess = async (
  target: FormAccessTarget,
  caller: CallerIdentity,
  required: PermissionCode,
): Promise<boolean> => {
  // The anonymous public user belongs to no workspace, so its permissions are not read.
  const userId = caller.actorId && caller.idpCode !== PUBLIC_PROVIDER_CODE ? caller.actorId : null;
  const facts = await findSubmitterFormFacts({ userId, ...target });
  return !!facts && formAccessAllows(facts, caller, required);
};
