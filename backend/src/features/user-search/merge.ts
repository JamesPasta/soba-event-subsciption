import { compareTextForSort, type SortLocale, type UserSearchUser } from '@soba/lib';
import type { UserSearchHit } from '../../core/integrations/user-search/UserSearchAdapter';

export interface PluginHits {
  code: string;
  hits: readonly UserSearchHit[];
}

export type MergedHit = UserSearchHit & { sources: string[] };

const HIT_FIELDS = ['guid', 'username', 'displayName', 'firstName', 'lastName', 'email'] as const;

/** One key per identity. Subjects compare without case. */
export const identityKey = (identityProvider: string, subject: string): string =>
  JSON.stringify([identityProvider, subject.toLowerCase()]);

/** One person per identity across plugins. An earlier plugin's value for a field wins. */
export function mergeHits(results: readonly PluginHits[]): MergedHit[] {
  const people = new Map<string, MergedHit>();
  for (const { code, hits } of results) {
    for (const hit of hits) {
      const key = identityKey(hit.identityProvider, hit.subject);
      const person = people.get(key);
      if (!person) {
        people.set(key, { ...hit, sources: [code] });
        continue;
      }
      for (const field of HIT_FIELDS) person[field] ??= hit[field];
      if (!person.sources.includes(code)) person.sources.push(code);
    }
  }
  return [...people.values()];
}

/** The display name, else the first and last names. */
export const displayNameOf = (
  hit: Pick<UserSearchHit, 'displayName' | 'firstName' | 'lastName'>,
): string | null =>
  hit.displayName ?? ([hit.firstName, hit.lastName].filter(Boolean).join(' ') || null);

/** Soba users first, then by display name, email and subject in the caller's collation. */
export function orderUsers(users: readonly UserSearchUser[], locale: SortLocale): UserSearchUser[] {
  return [...users].sort(
    (a, b) =>
      Number(b.sobaUserId !== null) - Number(a.sobaUserId !== null) ||
      compareTextForSort(a.displayName, b.displayName, 'asc', locale, { linguistic: true }) ||
      compareTextForSort(a.email, b.email, 'asc', locale) ||
      compareTextForSort(a.subject, b.subject, 'asc', locale),
  );
}
