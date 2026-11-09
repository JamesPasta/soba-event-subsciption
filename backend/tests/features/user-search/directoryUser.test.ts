import type { UserSearchHit } from '../../../src/core/integrations/user-search/UserSearchAdapter';
import {
  confirmedPerson,
  profileFromHit,
  signInSubjectOf,
} from '../../../src/features/user-search/directoryUser';

const GUID = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';

const hit = (changes: Partial<UserSearchHit> = {}): UserSearchHit => ({
  identityProvider: 'azureidir',
  subject: `${GUID.toLowerCase()}@azureidir`,
  guid: GUID,
  username: 'JSMITH',
  displayName: 'Smith, Jo',
  firstName: 'Jo',
  lastName: 'Smith',
  email: 'jo.smith@example.gov.bc.ca',
  ...changes,
});

describe('signInSubjectOf', () => {
  it('is the guid in lower case at the identity provider', () => {
    expect(signInSubjectOf('bceidbusiness', 'ABC123')).toBe('abc123@bceidbusiness');
  });
});

describe('confirmedPerson', () => {
  it('returns the one person with the guid, whatever its case', () => {
    const person = hit();
    expect(confirmedPerson([person], 'azureidir', GUID.toLowerCase())).toBe(person);
  });

  it('ignores people at another identity provider', () => {
    expect(() => confirmedPerson([hit({ identityProvider: 'idir' })], 'azureidir', GUID)).toThrow(
      expect.objectContaining({ statusCode: 404, code: 'person_not_found' }),
    );
  });

  it.each([
    ['a subject that is not the guid at the provider', [hit({ subject: 'jsmith@azureidir' })]],
    ['two people with the guid', [hit(), hit({ subject: 'other@azureidir' })]],
  ])('refuses %s', (_case, people) => {
    expect(() => confirmedPerson(people, 'azureidir', GUID)).toThrow(
      expect.objectContaining({ statusCode: 422, code: 'identity_unconfirmed' }),
    );
  });
});

describe('profileFromHit', () => {
  it('keeps the directory details and labels the person by username first', () => {
    expect(profileFromHit(hit())).toEqual({
      displayName: 'Smith, Jo',
      email: 'jo.smith@example.gov.bc.ca',
      preferredUsername: 'JSMITH',
      firstName: 'Jo',
      lastName: 'Smith',
      idir_username: 'JSMITH',
      bceid_username: null,
      displayLabel: 'JSMITH',
    });
  });

  it('keeps a BCeID username where sign-in keeps it', () => {
    expect(profileFromHit(hit({ identityProvider: 'bceidbusiness' }))).toMatchObject({
      idir_username: null,
      bceid_username: 'JSMITH',
    });
  });

  it('falls back to the email, then the name, for the label', () => {
    expect(profileFromHit(hit({ username: null })).displayLabel).toBe('jo.smith@example.gov.bc.ca');
    expect(
      profileFromHit(hit({ username: null, email: null, displayName: null })).displayLabel,
    ).toBe('Jo Smith');
  });
});
