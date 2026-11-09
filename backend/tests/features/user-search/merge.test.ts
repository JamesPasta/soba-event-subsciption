import type { UserSearchUser } from '@soba/lib';
import type { UserSearchHit } from '../../../src/core/integrations/user-search/UserSearchAdapter';
import {
  displayNameOf,
  identityKey,
  mergeHits,
  orderUsers,
} from '../../../src/features/user-search/merge';

const hit = (overrides: Partial<UserSearchHit>): UserSearchHit => ({
  identityProvider: 'azureidir',
  subject: 'a1@azureidir',
  guid: null,
  username: null,
  displayName: null,
  firstName: null,
  lastName: null,
  email: null,
  ...overrides,
});

const user = (overrides: Partial<UserSearchUser>): UserSearchUser => ({
  ...hit({}),
  sobaUserId: null,
  sources: ['css-v1'],
  ...overrides,
});

describe('mergeHits', () => {
  it('merges one identity across plugins, earlier plugins winning each field', () => {
    const merged = mergeHits([
      {
        code: 'other-v1',
        hits: [hit({ subject: 'A1@azureidir', firstName: 'Alice', email: null })],
      },
      {
        code: 'css-v1',
        hits: [
          hit({ firstName: 'Alicia', email: 'alice@example.com', guid: 'A1' }),
          hit({ subject: 'b2@azureidir', firstName: 'Bob' }),
        ],
      },
    ]);

    expect(merged).toEqual([
      {
        ...hit({ subject: 'A1@azureidir', firstName: 'Alice' }),
        email: 'alice@example.com',
        guid: 'A1',
        sources: ['other-v1', 'css-v1'],
      },
      { ...hit({ subject: 'b2@azureidir', firstName: 'Bob' }), sources: ['css-v1'] },
    ]);
  });

  it('keeps the same subject under different identity providers apart', () => {
    const merged = mergeHits([
      {
        code: 'css-v1',
        hits: [
          hit({ identityProvider: 'idir', subject: 'x' }),
          hit({ identityProvider: 'azureidir', subject: 'x' }),
        ],
      },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('identityKey', () => {
  it('ignores subject case but not the identity provider', () => {
    expect(identityKey('azureidir', 'AB@azureidir')).toBe(identityKey('azureidir', 'ab@azureidir'));
    expect(identityKey('idir', 'ab')).not.toBe(identityKey('azureidir', 'ab'));
  });
});

describe('displayNameOf', () => {
  it('prefers the display name, then the first and last names', () => {
    expect(displayNameOf({ displayName: 'Smith, Alice', firstName: 'A', lastName: 'S' })).toBe(
      'Smith, Alice',
    );
    expect(displayNameOf({ displayName: null, firstName: 'Bob', lastName: null })).toBe('Bob');
    expect(displayNameOf({ displayName: null, firstName: null, lastName: null })).toBeNull();
  });
});

describe('orderUsers', () => {
  it('puts Soba users first, then orders by display name and email', () => {
    const ordered = orderUsers(
      [
        user({ subject: 'c', displayName: 'Carol' }),
        user({ subject: 'z', displayName: 'Zed', sobaUserId: 'u-z' }),
        user({ subject: 'b2', displayName: 'Bob', email: 'b2@example.com' }),
        user({ subject: 'b1', displayName: 'Bob', email: 'b1@example.com' }),
        user({ subject: 'n', displayName: null }),
      ],
      'en',
    );
    expect(ordered.map(({ subject }) => subject)).toEqual(['z', 'b1', 'b2', 'c', 'n']);
  });

  it('orders accented names alongside unaccented ones', () => {
    const names = ['Zoe', 'Émile', 'Eve'].map((displayName) => user({ displayName }));
    expect(orderUsers(names, 'fr').map(({ displayName }) => displayName)).toEqual([
      'Émile',
      'Eve',
      'Zoe',
    ]);
  });
});
