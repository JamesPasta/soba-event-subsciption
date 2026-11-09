export {
  USER_SEARCH_FIELDS,
  type CreateUserFromSearchResponse,
  type UserSearchCapabilitiesResponse,
  type UserSearchField,
  type UserSearchIdentityProvider,
  type UserSearchQuery,
  type UserSearchResponse,
  type UserSearchUser,
} from '@soba/lib';

/** Where a search runs: a form's team, or a workspace. */
export type UserSearchScope = { kind: 'form' | 'workspace'; id: string };
