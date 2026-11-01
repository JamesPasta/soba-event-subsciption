/** Shared user-facing messages, kept in one place so API docs and services can't drift. */
export const FORM_NAME_TAKEN = 'A form with this name already exists';
export const FORM_ID_TAKEN = 'Form id already in use';
export const FORM_VERSION_ID_TAKEN = 'Form version id already in use';
export const SOURCE_VERSION_HAS_NO_SCHEMA = 'The version to copy has no schema';
export const WORKSPACE_NAME_TAKEN = 'A workspace with this name already exists';
export const WORKSPACE_CREATE_FORBIDDEN =
  'Only users authenticated through a BC Government identity provider can create workspaces';
export const WORKSPACE_MANAGE_FORBIDDEN =
  'Only workspace owners or admins can manage this workspace';
export const GROUP_NAME_TAKEN = 'A group with this name already exists';
export const MEMBER_EXISTS = 'This person already has access to the workspace';
export const MEMBER_NOT_FOUND = 'Member not found';
export const USER_NOT_ADDABLE = 'User not found, not active, or without a sign-in identity';
export const MEMBER_PROTECTED = 'The workspace owner and your own access cannot be removed';
export const LAST_FORM_ADMIN = 'Form administrators must keep at least one member';
