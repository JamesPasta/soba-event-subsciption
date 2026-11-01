jest.mock('../../../src/core/integrations/user-search/UserSearchRegistry', () => ({
  getEnabledUserSearchPluginCodes: jest.fn(),
  createUserSearchAdapter: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/identityProviderRepo', () => ({
  listLoginIdentityProviders: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/identityLookup', () => ({
  findIdentityOwners: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/membershipRepo', () => ({
  findOrCreateUserFromDirectory: jest.fn(),
}));

import {
  createUserSearchAdapter,
  getEnabledUserSearchPluginCodes,
} from '../../../src/core/integrations/user-search/UserSearchRegistry';
import { listLoginIdentityProviders } from '../../../src/core/db/repos/identityProviderRepo';
import { findIdentityOwners } from '../../../src/core/db/repos/identityLookup';
import { findOrCreateUserFromDirectory } from '../../../src/core/db/repos/membershipRepo';
import type {
  UserSearchCapability,
  UserSearchHit,
  UserSearchAdapter,
  UserSearchRequest,
} from '../../../src/core/integrations/user-search/UserSearchAdapter';
import { ServiceUnavailableError, ValidationError } from '../../../src/core/errors';
import {
  createUserFromSearch,
  getUserSearchCapabilities,
  PLUGIN_LIMIT,
  RESULT_LIMIT,
  searchUsers,
} from '../../../src/features/user-search/service';

const ALL = ['email', 'firstName', 'lastName', 'guid'] as const;

const hit = (subject: string, overrides: Partial<UserSearchHit> = {}): UserSearchHit => ({
  identityProvider: 'azureidir',
  subject,
  guid: null,
  username: null,
  displayName: null,
  firstName: null,
  lastName: null,
  email: null,
  ...overrides,
});

/** An in-memory adapter: what it can search, and how it answers. */
function adapter(
  capabilities: UserSearchCapability[],
  answer: (request: UserSearchRequest) => Promise<{ hits: UserSearchHit[]; truncated: boolean }>,
) {
  return {
    capabilities: () => Promise.resolve(capabilities),
    search: jest.fn(answer),
  } satisfies UserSearchAdapter;
}

const css = (answer: Parameters<typeof adapter>[1]) =>
  adapter(
    [
      { identityProvider: 'azureidir', fields: ALL },
      { identityProvider: 'bceidbusiness', fields: ['guid'] },
    ],
    answer,
  );
const other = (answer: Parameters<typeof adapter>[1]) =>
  adapter(
    [
      { identityProvider: 'azureidir', fields: ALL },
      { identityProvider: 'bceidbusiness', fields: ALL },
    ],
    answer,
  );

const found =
  (...hits: UserSearchHit[]) =>
  () =>
    Promise.resolve({ hits, truncated: false });

/** Answers each search with one person of the identity provider searched. */
const onePerson =
  (name: string) =>
  ({ identityProvider }: UserSearchRequest) =>
    found(hit(`${name}@${identityProvider}`, { identityProvider }))();

const searchedProviders = (plugin: ReturnType<typeof adapter>) =>
  plugin.search.mock.calls.map(([request]) => request.identityProvider);

/** Enable these plugins, in order; an Error stands for one that cannot be built. */
function enable(plugins: Record<string, UserSearchAdapter | Error>) {
  jest.mocked(getEnabledUserSearchPluginCodes).mockReturnValue(Object.keys(plugins));
  jest.mocked(createUserSearchAdapter).mockImplementation((code) => {
    const entry = plugins[code];
    if (entry instanceof Error) throw entry;
    return entry;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listLoginIdentityProviders).mockResolvedValue([
    { code: 'azureidir', name: 'IDIR - MFA' },
    { code: 'bceidbusiness', name: 'BCeID Business' },
  ]);
  jest.mocked(findIdentityOwners).mockResolvedValue([]);
});

describe('getUserSearchCapabilities', () => {
  it('lists each active identity provider with the filters some plugin accepts', async () => {
    enable({ 'css-v1': css(found()) });

    await expect(getUserSearchCapabilities({}, 'en')).resolves.toEqual({
      identityProviders: [
        { code: 'azureidir', name: 'IDIR - MFA', fields: [...ALL] },
        { code: 'bceidbusiness', name: 'BCeID Business', fields: ['guid'] },
      ],
    });
  });

  it('unions the filters across plugins, and the policy narrows the identity providers', async () => {
    enable({ 'css-v1': css(found()), 'other-v1': other(found()) });

    const all = await getUserSearchCapabilities({}, 'en');
    expect(all.identityProviders[1]).toEqual({
      code: 'bceidbusiness',
      name: 'BCeID Business',
      fields: [...ALL],
    });

    const narrowed = await getUserSearchCapabilities({ identityProviders: ['azureidir'] }, 'en');
    expect(narrowed.identityProviders.map(({ code }) => code)).toEqual(['azureidir']);
  });

  it('leaves out plugins that cannot be built, and offers nothing with none enabled', async () => {
    enable({ 'css-v1': new Error('PLUGIN_CSS_V1_CLIENT_SECRET is required') });
    await expect(getUserSearchCapabilities({}, 'en')).resolves.toEqual({ identityProviders: [] });

    enable({});
    await expect(getUserSearchCapabilities({}, 'en')).resolves.toEqual({ identityProviders: [] });
  });
});

describe('searchUsers', () => {
  it('asks only the plugins that accept every filter for the identity provider asked', async () => {
    const cssAdapter = css(found());
    const otherAdapter = other(
      found(hit('b1@bceidbusiness', { identityProvider: 'bceidbusiness' })),
    );
    enable({ 'css-v1': cssAdapter, 'other-v1': otherAdapter });

    const result = await searchUsers(
      { identityProvider: 'bceidbusiness', lastName: 'Smith' },
      {},
      'en',
    );

    expect(cssAdapter.search).not.toHaveBeenCalled();
    expect(otherAdapter.search).toHaveBeenCalledTimes(1);
    expect(otherAdapter.search).toHaveBeenCalledWith({
      identityProvider: 'bceidbusiness',
      filters: { lastName: 'Smith' },
      limit: PLUGIN_LIMIT,
    });
    expect(result.plugins).toEqual([{ code: 'other-v1', status: 'ok', truncated: false }]);
    expect(result.users.map(({ subject }) => subject)).toEqual(['b1@bceidbusiness']);
  });

  it('searches every identity provider each plugin accepts when none is asked', async () => {
    const cssAdapter = css(onePerson('c'));
    const otherAdapter = other(onePerson('o'));
    enable({ 'css-v1': cssAdapter, 'other-v1': otherAdapter });

    const result = await searchUsers({ lastName: 'Smith' }, {}, 'en');

    expect(searchedProviders(cssAdapter)).toEqual(['azureidir']);
    expect(searchedProviders(otherAdapter)).toEqual(['azureidir', 'bceidbusiness']);
    expect(new Set(result.users.map(({ subject }) => subject))).toEqual(
      new Set(['c@azureidir', 'o@azureidir', 'o@bceidbusiness']),
    );
    expect(result.plugins).toEqual([
      { code: 'css-v1', status: 'ok', truncated: false },
      { code: 'other-v1', status: 'ok', truncated: false },
    ]);
  });

  it('keeps a search without an identity provider to the ones the policy allows', async () => {
    const cssAdapter = css(onePerson('c'));
    enable({ 'css-v1': cssAdapter });

    const result = await searchUsers(
      { guid: 'F0E1D2C3' },
      { identityProviders: ['bceidbusiness'] },
      'en',
    );

    expect(searchedProviders(cssAdapter)).toEqual(['bceidbusiness']);
    expect(result.users.map(({ subject }) => subject)).toEqual(['c@bceidbusiness']);
  });

  it('reports a plugin unavailable if any search failed, and rejected only if all were refused', async () => {
    enable({
      'css-v1': css((request) =>
        request.identityProvider === 'bceidbusiness'
          ? Promise.reject(new ServiceUnavailableError())
          : found(hit('a1@azureidir'))(),
      ),
      'other-v1': other((request) =>
        request.identityProvider === 'bceidbusiness'
          ? Promise.reject(new ValidationError('refused'))
          : Promise.resolve({ hits: [hit('a2@azureidir')], truncated: true }),
      ),
      'strict-v1': other(() => Promise.reject(new ValidationError('refused'))),
    });

    const result = await searchUsers({ guid: 'F0E1D2C3' }, {}, 'en');

    expect(result.users).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.plugins).toEqual([
      { code: 'css-v1', status: 'unavailable', truncated: false },
      { code: 'other-v1', status: 'ok', truncated: true },
      { code: 'strict-v1', status: 'rejected', truncated: false },
    ]);
  });

  it('merges people across plugins and marks the ones who are Soba users', async () => {
    enable({
      'css-v1': css(
        found(
          hit('A1@azureidir', { displayName: 'Smith, Alice', email: 'alice@example.com' }),
          hit('c3@azureidir', { firstName: 'Carl' }),
        ),
      ),
      'other-v1': other(found(hit('a1@azureidir', { firstName: 'Alice' }))),
    });
    jest
      .mocked(findIdentityOwners)
      .mockResolvedValue([
        { identityProvider: 'azureidir', subject: 'a1@azureidir', userId: 'user-a' },
      ]);

    const result = await searchUsers({ identityProvider: 'azureidir', firstName: 'Al' }, {}, 'en');

    expect(result.users).toEqual([
      {
        ...hit('A1@azureidir', {
          displayName: 'Smith, Alice',
          email: 'alice@example.com',
          firstName: 'Alice',
        }),
        sobaUserId: 'user-a',
        sources: ['css-v1', 'other-v1'],
      },
      {
        ...hit('c3@azureidir', { firstName: 'Carl', displayName: 'Carl' }),
        sobaUserId: null,
        sources: ['css-v1'],
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('answers with the plugins that could, and says which could not', async () => {
    enable({
      'css-v1': css(() => Promise.reject(new ServiceUnavailableError())),
      'other-v1': other(found(hit('a1@azureidir'))),
      'broken-v1': new Error('missing config'),
    });

    const result = await searchUsers(
      { identityProvider: 'azureidir', email: 'alice@example.com' },
      {},
      'en',
    );

    expect(result.users).toHaveLength(1);
    expect(result.plugins).toEqual([
      { code: 'css-v1', status: 'unavailable', truncated: false },
      { code: 'other-v1', status: 'ok', truncated: false },
      { code: 'broken-v1', status: 'unavailable', truncated: false },
    ]);
  });

  it('is unavailable when no plugin could answer', async () => {
    enable({
      'css-v1': css(() => Promise.reject(new ValidationError('refused'))),
      'other-v1': other(() => Promise.reject(new Error('socket hang up'))),
    });

    await expect(searchUsers({ guid: 'F0E1D2C3' }, {}, 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it('is a validation error when every plugin refused the filters', async () => {
    enable({ 'css-v1': css(() => Promise.reject(new ValidationError('refused'))) });

    await expect(searchUsers({ guid: 'F0E1D2C3' }, {}, 'en')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('refuses filters no plugin accepts, unless a plugin could not be built', async () => {
    const bceidByName = { identityProvider: 'bceidbusiness', lastName: 'Smith' };
    enable({ 'css-v1': css(found()) });
    await expect(searchUsers(bceidByName, {}, 'en')).rejects.toBeInstanceOf(ValidationError);

    enable({ 'css-v1': css(found()), 'other-v1': new Error('missing config') });
    await expect(searchUsers(bceidByName, {}, 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it('is unavailable with no plugins enabled', async () => {
    enable({});

    await expect(searchUsers({ lastName: 'Smith' }, {}, 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it('reports a plugin that throws before it returns a promise', async () => {
    const throwsAtOnce: UserSearchAdapter = {
      capabilities: () => Promise.resolve([{ identityProvider: 'azureidir', fields: ALL }]),
      search: () => {
        throw new Error('not a promise');
      },
    };
    enable({ 'sync-v1': throwsAtOnce, 'other-v1': other(found(hit('a1@azureidir'))) });

    const result = await searchUsers(
      { identityProvider: 'azureidir', lastName: 'Smith' },
      {},
      'en',
    );

    expect(result.plugins[0]).toEqual({
      code: 'sync-v1',
      status: 'unavailable',
      truncated: false,
    });
    expect(result.users).toHaveLength(1);
  });

  it('refuses an identity provider that is inactive or outside the policy', async () => {
    enable({ 'css-v1': css(found()) });

    await expect(
      searchUsers({ identityProvider: 'idir', guid: 'F0E1D2C3' }, {}, 'en'),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      searchUsers(
        { identityProvider: 'azureidir', guid: 'F0E1D2C3' },
        { identityProviders: ['bceidbusiness'] },
        'en',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('caps the people returned and says when more were found', async () => {
    const many = Array.from({ length: RESULT_LIMIT + 5 }, (_, i) => hit(`u${i}@azureidir`));
    enable({
      'css-v1': css(() => Promise.resolve({ hits: many.slice(0, 30), truncated: true })),
      'other-v1': other(found(...many.slice(30))),
    });

    const result = await searchUsers(
      { identityProvider: 'azureidir', lastName: 'Smith' },
      {},
      'en',
    );

    expect(result.users).toHaveLength(RESULT_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.plugins[0]).toEqual({ code: 'css-v1', status: 'ok', truncated: true });
  });
});

describe('createUserFromSearch', () => {
  const GUID = 'F0E1D2C3B4A59687';
  const ACTOR = { actorId: 'actor-1', actorDisplayLabel: 'Actor One' };
  const person = hit(`${GUID.toLowerCase()}@azureidir`, {
    guid: GUID,
    username: 'JSMITH',
    email: 'jo.smith@example.gov.bc.ca',
  });

  beforeEach(() => {
    jest
      .mocked(findOrCreateUserFromDirectory)
      .mockResolvedValue({ userId: 'user-new', created: true });
  });

  it('makes the user from the directory hit, keyed by the lower-case sign-in subject', async () => {
    const directory = css(found(person));
    enable({ 'css-v1': directory });

    await expect(
      createUserFromSearch({ identityProvider: 'azureidir', guid: GUID }, {}, 'en', ACTOR),
    ).resolves.toEqual({ userId: 'user-new', created: true });

    expect(directory.search).toHaveBeenCalledWith(
      expect.objectContaining({ identityProvider: 'azureidir', filters: { guid: GUID } }),
    );
    expect(findOrCreateUserFromDirectory).toHaveBeenCalledWith({
      providerCode: 'azureidir',
      subject: `${GUID.toLowerCase()}@azureidir`,
      profile: expect.objectContaining({ idir_username: 'JSMITH', displayLabel: 'JSMITH' }),
      actorDisplayLabel: 'Actor One',
    });
  });

  it('refuses an identity provider that cannot be searched here, before asking anyone', async () => {
    const directory = css(found(person));
    enable({ 'css-v1': directory });

    await expect(
      createUserFromSearch({ identityProvider: 'idir', guid: GUID }, {}, 'en', ACTOR),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(directory.search).not.toHaveBeenCalled();
    expect(findOrCreateUserFromDirectory).not.toHaveBeenCalled();
  });

  it('says the directory is unavailable rather than that no one has the guid', async () => {
    enable({
      'css-v1': css(() => Promise.reject(new ServiceUnavailableError('down'))),
      'other-v1': other(found()),
    });

    await expect(
      createUserFromSearch({ identityProvider: 'azureidir', guid: GUID }, {}, 'en', ACTOR),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(findOrCreateUserFromDirectory).not.toHaveBeenCalled();
  });

  it('answers person_not_found when every plugin answered and no one has the guid', async () => {
    enable({
      'css-v1': css(() => Promise.reject(new ValidationError('refused'))),
      'other-v1': other(found(hit('someone@azureidir', { guid: 'OTHERGUID' }))),
    });

    await expect(
      createUserFromSearch({ identityProvider: 'azureidir', guid: GUID }, {}, 'en', ACTOR),
    ).rejects.toMatchObject({ statusCode: 404, code: 'person_not_found' });
  });

  it('returns the existing user when another plugin still finds them while the directory is down', async () => {
    jest
      .mocked(findOrCreateUserFromDirectory)
      .mockResolvedValue({ userId: 'user-old', created: false });
    enable({
      'css-v1': css(() => Promise.reject(new ServiceUnavailableError('down'))),
      'other-v1': other(found(person)),
    });

    await expect(
      createUserFromSearch({ identityProvider: 'azureidir', guid: GUID }, {}, 'en', ACTOR),
    ).resolves.toEqual({ userId: 'user-old', created: false });
  });
});
