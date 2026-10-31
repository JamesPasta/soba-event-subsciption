export const Permissions = {
  all: '*',
  form_create: 'form_create',
  form_read: 'form_read',
  form_update: 'form_update',
  form_delete: 'form_delete',
  design_create: 'design_create',
  design_read: 'design_read',
  design_update: 'design_update',
  design_delete: 'design_delete',
  submission_create: 'submission_create',
  submission_read: 'submission_read',
  submission_update: 'submission_update',
  submission_delete: 'submission_delete',
  submission_review: 'submission_review',
  submission_print_upload: 'submission_print_upload',
  team_read: 'team_read',
  team_update: 'team_update',
  document_template_create: 'document_template_create',
  document_template_read: 'document_template_read',
  document_template_delete: 'document_template_delete',
} as const;

export type PermissionCode = (typeof Permissions)[keyof typeof Permissions];

/**
 * POST /forms writes the form and its first design. `form_create` is not seeded onto any role;
 * only form_admin matches it (via `*`). form_designer has `design_create` for new designs on
 * existing forms.
 */
export const FormCreatePermissions = [Permissions.form_create, Permissions.design_create] as const;

/**
 * Printing a submission with a template uploaded for that print only. submission_reviewer and
 * submission_approver hold both.
 */
export const PrintUploadPermissions = [
  Permissions.submission_read,
  Permissions.submission_print_upload,
] as const;

/** What Print does for one caller on one submission (printChoiceOf). */
export const PrintChoice = {
  /** The browser's print. */
  browser: 'browser',
  /** Downloads a document rendered from the form version's stored template. */
  template: 'template',
  /** Staff pick the browser's print, the stored template or an uploaded one. */
  options: 'options',
} as const;
export type PrintChoiceCode = (typeof PrintChoice)[keyof typeof PrintChoice];

/** Provider code of the shared public user that anonymous callers resolve to. */
export const PUBLIC_PROVIDER_CODE = 'public';

/**
 * Seeded login identity providers (soba.identity_provider). Each code is the SSO token's
 * identity_provider claim, lowercased.
 */
export const IdentityProviders = {
  idir: 'idir',
  azureidir: 'azureidir',
  bceidbusiness: 'bceidbusiness',
} as const;
export type IdentityProviderCode = (typeof IdentityProviders)[keyof typeof IdentityProviders];

/** Submission lifecycle state (submission.workflow_state). Backend-owned; clients never set it. */
export const SubmissionWorkflowState = {
  opened: 'opened',
  draft: 'draft',
  submitted: 'submitted',
  deleted: 'deleted',
} as const;
export type SubmissionWorkflowStateCode =
  (typeof SubmissionWorkflowState)[keyof typeof SubmissionWorkflowState];

/**
 * A user's standing on one submission (submission_participant.role). Owners and collaborators have
 * the same access, except that only an owner deletes the submission.
 */
export const SubmissionParticipantRole = {
  owner: 'owner',
  collaborator: 'collaborator',
} as const;
export type SubmissionParticipantRoleCode =
  (typeof SubmissionParticipantRole)[keyof typeof SubmissionParticipantRole];

export const DraftSaveStatus = {
  allowed: 'allowed',
  /** allowSubmitterDrafts is off. */
  disabled: 'disabled',
  /** The form's effective audience is public, where no one owns a draft. */
  public: 'public',
} as const;
export type DraftSaveStatusCode = (typeof DraftSaveStatus)[keyof typeof DraftSaveStatus];

/** Whether a change goes ahead, is refused for this caller, or is refused for the target's state. */
export const SubmissionChangeStatus = {
  allowed: 'allowed',
  denied: 'denied',
  closed: 'closed',
} as const;
export type SubmissionChangeStatusCode =
  (typeof SubmissionChangeStatus)[keyof typeof SubmissionChangeStatus];

/**
 * Why an API request failed; an error response carries it as `code`. A `*_denied` refusal and
 * `sign_in_required` are 401 for an anonymous caller and 403 otherwise; `drafts_*` is 403;
 * `*_closed`, `*_taken`, `version_not_published`, `already_exists`, `member_exists`,
 * `member_protected` and `last_form_admin` are 409; `*_not_found` and `not_published` are 404;
 * `*_invalid` and `form_not_ready` are 400; `*_unavailable` and `render_busy` are 503;
 * `render_failed`, `no_saved_data`, `file_infected` and `identity_unconfirmed` are 422;
 * `file_type_blocked` is 415; `file_too_large` and `request_too_large` are 413;
 * `engine_*_rejected` are 400; `unauthenticated` is 401; `rate_limited` and `*_limit_reached` are
 * 429; `engine_document_missing` and `internal_error` are 500.
 */
export const ApiErrorCodes = {
  open_denied: 'open_denied',
  read_denied: 'read_denied',
  write_denied: 'write_denied',
  render_denied: 'render_denied',
  delete_denied: 'delete_denied',
  drafts_disabled: 'drafts_disabled',
  drafts_public: 'drafts_public',
  upload_closed: 'upload_closed',
  delete_closed: 'delete_closed',
  not_published: 'not_published',
  // Opening a submission.
  form_not_found: 'form_not_found',
  submission_id_taken: 'submission_id_taken',
  version_not_published: 'version_not_published',
  // An existing submission and its writes.
  submission_not_found: 'submission_not_found',
  schema_not_found: 'schema_not_found',
  content_not_found: 'content_not_found',
  revision_id_taken: 'revision_id_taken',
  revision_base_invalid: 'revision_base_invalid',
  form_not_ready: 'form_not_ready',
  engine_document_missing: 'engine_document_missing',
  engine_data_rejected: 'engine_data_rejected',
  engine_schema_rejected: 'engine_schema_rejected',
  // Files.
  file_not_found: 'file_not_found',
  file_unavailable: 'file_unavailable',
  file_type_blocked: 'file_type_blocked',
  file_too_large: 'file_too_large',
  upload_invalid: 'upload_invalid',
  file_infected: 'file_infected',
  scan_unavailable: 'scan_unavailable',
  // Documents.
  template_not_found: 'template_not_found',
  template_unavailable: 'template_unavailable',
  render_unavailable: 'render_unavailable',
  render_busy: 'render_busy',
  render_failed: 'render_failed',
  no_saved_data: 'no_saved_data',
  // Workspace groups.
  group_name_taken: 'group_name_taken',
  // Workspace access.
  member_exists: 'member_exists',
  member_protected: 'member_protected',
  last_form_admin: 'last_form_admin',
  // A Soba user made from a user search result.
  person_not_found: 'person_not_found',
  identity_unconfirmed: 'identity_unconfirmed',
  // Submission exports: the form already has as many running as allowed.
  export_limit_reached: 'export_limit_reached',
  // Any route.
  request_invalid: 'request_invalid',
  request_too_large: 'request_too_large',
  unauthenticated: 'unauthenticated',
  sign_in_required: 'sign_in_required',
  already_exists: 'already_exists',
  workspace_name_taken: 'workspace_name_taken',
  route_not_found: 'route_not_found',
  rate_limited: 'rate_limited',
  internal_error: 'internal_error',
} as const;
export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];
