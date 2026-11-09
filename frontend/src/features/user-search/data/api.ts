import type { SortLocale } from '@soba/lib/sort';
import { sobaFetch } from '@/src/shared/api/sobaFetch';
import { parseJson } from '@/src/shared/api/sobaHelpers';
import { sortLocaleHeaders } from '@/src/shared/api/sortLocaleRequest';
import type {
  CreateUserFromSearchResponse,
  UserSearchCapabilitiesResponse,
  UserSearchQuery,
  UserSearchResponse,
  UserSearchScope,
} from '@/src/types/userSearch';

const scopePath = ({ kind, id }: UserSearchScope): string =>
  kind === 'form'
    ? `/design/forms/${encodeURIComponent(id)}/user-search`
    : `/workspaces/${encodeURIComponent(id)}/user-search`;

/** The identity providers searchable in the scope, each with the filters it accepts. */
export async function fetchUserSearchCapabilities(
  token: string,
  scope: UserSearchScope,
  locale: SortLocale,
): Promise<UserSearchCapabilitiesResponse> {
  const response = await sobaFetch(`${scopePath(scope)}/capabilities`, {
    token,
    headers: sortLocaleHeaders(locale),
  });
  return parseJson(response);
}

/**
 * People found across the enabled plugins, in query.identityProvider or else every identity
 * provider searchable here. Searching creates no account or membership.
 */
export async function searchUsers(
  token: string,
  scope: UserSearchScope,
  query: UserSearchQuery,
  locale: SortLocale,
): Promise<UserSearchResponse> {
  const response = await sobaFetch(scopePath(scope), {
    token,
    query,
    headers: sortLocaleHeaders(locale),
  });
  return parseJson(response);
}

/**
 * The Soba user for a person found by search, made from the directory when they have never signed
 * in. The server asks the directory again by guid; `created` is false when one already existed.
 */
export async function createUserFromSearch(
  token: string,
  scope: UserSearchScope,
  person: { identityProvider: string; guid: string },
): Promise<CreateUserFromSearchResponse> {
  const response = await sobaFetch(`${scopePath(scope)}/users`, {
    token,
    method: 'POST',
    json: person,
  });
  return parseJson(response);
}
