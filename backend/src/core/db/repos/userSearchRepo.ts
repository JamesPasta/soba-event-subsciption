import { and, asc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import type { UserSearchField } from '@soba/lib';
import { db } from '../client';
import { AppUserStatus } from '../codes';
import { appUsers, userIdentities } from '../schema';
import { prefixPattern } from '../listSort';

export interface SobaUserSearchInput {
  identityProvider: string;
  filters: Partial<Record<UserSearchField, string>>;
  limit: number;
}

export interface SobaUserSearchRow {
  subject: string;
  profile: unknown;
  idpAttributes: unknown;
}

const profileText = (key: string): SQL => sql`coalesce(${appUsers.profile}->>${key}, '')`;

/** The profile field starts with the term or, when that field is empty, a display name word does. */
const nameMatches = (field: 'firstName' | 'lastName', term: string): SQL => {
  const fieldMatches = sql`${profileText(field)} ilike ${prefixPattern(term)}`;
  // The display name is compared as words, so the term's punctuation becomes spaces too.
  const words = term.replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!words) return fieldMatches;
  const wordStart = `% ${prefixPattern(words)}`;
  return sql`(${fieldMatches}
  or (${profileText(field)} = ''
    and ' ' || regexp_replace(${profileText('displayName')}, '[^[:alnum:]]+', ' ', 'g')
      ilike ${wordStart}))`;
};

/**
 * Active Soba users holding an identity with this provider, matching every filter. Returns one row
 * more than the limit when there are more.
 */
export async function searchSobaUsers(input: SobaUserSearchInput): Promise<SobaUserSearchRow[]> {
  const { identityProvider, filters, limit } = input;
  const conditions: SQL[] = [
    eq(userIdentities.identityProviderCode, identityProvider),
    eq(appUsers.status, AppUserStatus.active),
  ];
  if (filters.email) conditions.push(ilike(profileText('email'), prefixPattern(filters.email)));
  if (filters.firstName) conditions.push(nameMatches('firstName', filters.firstName));
  if (filters.lastName) conditions.push(nameMatches('lastName', filters.lastName));
  if (filters.guid) {
    // BC Gov SSO subjects are `<guid>@<provider>`, in lower case.
    conditions.push(
      eq(userIdentities.subject, `${filters.guid.toLowerCase()}@${identityProvider}`),
    );
  }
  return await db
    .select({
      subject: userIdentities.subject,
      profile: appUsers.profile,
      idpAttributes: userIdentities.idpAttributes,
    })
    .from(userIdentities)
    .innerJoin(appUsers, eq(appUsers.id, userIdentities.userId))
    .where(and(...conditions))
    .orderBy(sql`lower(${appUsers.profile}->>'displayName') asc nulls last`, asc(userIdentities.id))
    .limit(limit + 1);
}
