import { ApiErrorCodes } from '@soba/lib';
import type { NormalizedProfile } from '../../core/auth/jwtClaims';
import { NotFoundError, UnprocessableEntityError } from '../../core/errors';
import type { UserSearchHit } from '../../core/integrations/user-search/UserSearchAdapter';
import { displayNameOf } from './merge';

/** BC Gov SSO sign-in subjects are `<guid>@<provider>`, in lower case. */
export const signInSubjectOf = (identityProvider: string, guid: string): string =>
  `${guid.toLowerCase()}@${identityProvider}`;

/** The person is at the identity provider and has the guid, compared without case. */
export const hasGuid = (person: UserSearchHit, identityProvider: string, guid: string): boolean =>
  person.identityProvider === identityProvider && person.guid?.toLowerCase() === guid.toLowerCase();

/**
 * The one person the directory found for the guid, when their subject is the one sign-in will
 * send. Anything else could make a user that sign-in never finds.
 */
export function confirmedPerson<T extends UserSearchHit>(
  people: readonly T[],
  identityProvider: string,
  guid: string,
): T {
  const matches = people.filter((person) => hasGuid(person, identityProvider, guid));
  if (matches.length === 0) {
    throw new NotFoundError('No one with that guid was found', ApiErrorCodes.person_not_found);
  }
  const [person] = matches;
  if (
    matches.length > 1 ||
    person.subject.toLowerCase() !== signInSubjectOf(identityProvider, guid)
  ) {
    throw new UnprocessableEntityError(
      'The directory identity could not be confirmed',
      ApiErrorCodes.identity_unconfirmed,
    );
  }
  return person;
}

/**
 * The stored profile for a person made from a search result, in the fields sign-in stores. The
 * label prefers the username, as sign-in does, so it stays the same at first sign-in.
 */
export function profileFromHit(hit: UserSearchHit): NormalizedProfile {
  const displayName = displayNameOf(hit);
  const bceid = hit.identityProvider.startsWith('bceid');
  return {
    displayName,
    email: hit.email,
    preferredUsername: hit.username,
    firstName: hit.firstName,
    lastName: hit.lastName,
    idir_username: bceid ? null : hit.username,
    bceid_username: bceid ? hit.username : null,
    displayLabel: hit.username ?? hit.email ?? displayName,
  };
}
