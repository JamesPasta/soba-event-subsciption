import type { FormAccessGrant } from '../db/repos/formAccessRepo';

/**
 * Core per-request workspace context, populated by the per-route workspace middleware in
 * `workspaceContext.ts` (`workspaceFromQuery` / `workspaceFromResource`). Actor-only routes
 * (e.g. GET /me, GET /workspaces) do not set this and read `req.actorId` directly.
 */
export interface CoreRequestContext {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  workspaceSource: string;
  /** The form the resolved resource or list anchor is, or belongs to. */
  formId?: string;
  /**
   * The actor's workspace membership role (owner/admin/member/viewer), read on every request. Null
   * for a caller with no membership on the submit surface, and in every context setSubmitContext
   * builds; no workspace role check accepts null.
   */
  role: string | null;
  /**
   * The actor's permission codes on `formId`, or on the workspace without one. Set by
   * requireFormPermissions.
   */
  permissions?: ReadonlySet<string>;
}

/**
 * Scope for *list/search* routes, populated by `workspaceListScope` and `requireFormPermissions`.
 * Membership in an anchored workspace is verified before listing.
 */
export interface CoreListScope {
  actorId: string;
  /** The anchored workspace, or every workspace the actor is an active member of. */
  workspaceIds: string[];
  /** The workspace resolved from the scope anchor. */
  selectedWorkspaceId?: string;
  /** The forms the list may show, resolved by requireFormPermissions. */
  formAccess?: FormAccessGrant;
}
