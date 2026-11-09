import { userSearchPluginDefinition } from '../../../src/plugins/css-v1';
import { CssUserSearchAdapter } from '../../../src/plugins/css-v1/cssUserSearchAdapter';
import {
  createPluginConfigReaderFrom,
  type PluginConfigReader,
} from '../../../src/core/config/pluginConfig';
import { createEnvReader } from '../../../src/core/config/env';
import { clearOAuth2TokenCache } from '../../../src/core/auth/oauth2TokenProvider';
import { ServiceUnavailableError, ValidationError } from '../../../src/core/errors';
import { json, startCss, type FakeCss } from './fakeCss';

let css: FakeCss;

const cssUser = {
  username: 'f0e1d2c3@azureidir',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Smith',
  attributes: {
    display_name: ['Smith, Alice CITZ:EX'],
    idir_user_guid: ['F0E1D2C3'],
    idir_username: ['ASMITH'],
  },
};

function makeConfig(overrides: Record<string, string | undefined> = {}): PluginConfigReader {
  const values: Record<string, string | undefined> = {
    API_BASE_URL: `${css.origin}/api/v1`,
    ENVIRONMENT: 'test',
    TOKEN_URL: `${css.origin}/token`,
    CLIENT_ID: 'css-client',
    CLIENT_SECRET: 'css-secret',
    ...overrides,
  };
  return createPluginConfigReaderFrom(
    createEnvReader(
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [`PLUGIN_CSS_V1_${key}`, value]),
      ),
    ),
    'css-v1',
  );
}

const lookups = () => css.requests.filter(({ path }) => path !== '/token');
const tokenCalls = () => css.requests.filter(({ path }) => path === '/token');

beforeEach(async () => {
  css = await startCss();
  css.answer(() => json({ data: [cssUser] }));
});

afterEach(async () => {
  clearOAuth2TokenCache();
  await css.close();
});

describe('css-v1 user search adapter', () => {
  it('declares the plugin', () => {
    expect(userSearchPluginDefinition.code).toBe('css-v1');
    expect(userSearchPluginDefinition.metadata).toEqual({
      code: 'css-v1',
      name: 'CSS user search',
      version: 'v1',
    });
  });

  it('searches IDIR by name, email or guid and BCeID Business by guid only', async () => {
    const capabilities = await new CssUserSearchAdapter(makeConfig()).capabilities();
    expect(capabilities).toEqual([
      { identityProvider: 'idir', fields: ['email', 'firstName', 'lastName', 'guid'] },
      { identityProvider: 'azureidir', fields: ['email', 'firstName', 'lastName', 'guid'] },
      { identityProvider: 'bceidbusiness', fields: ['guid'] },
    ]);
  });

  it('looks Azure IDIR users up with a service token and maps them to hits', async () => {
    const result = await new CssUserSearchAdapter(makeConfig()).search({
      identityProvider: 'azureidir',
      filters: { firstName: 'Alice', email: 'alice+test@example.com' },
      limit: 25,
    });

    expect(lookups()).toHaveLength(1);
    expect(lookups()[0].path).toBe('/api/v1/test/azure-idir/users');
    expect(Object.fromEntries(lookups()[0].query)).toEqual({
      email: 'alice+test@example.com',
      firstName: 'Alice',
    });
    expect(lookups()[0].authorization).toBe('Bearer token-1');
    expect(result).toEqual({
      hits: [
        {
          identityProvider: 'azureidir',
          subject: 'f0e1d2c3@azureidir',
          guid: 'F0E1D2C3',
          username: 'ASMITH',
          displayName: 'Smith, Alice CITZ:EX',
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
        },
      ],
      truncated: false,
    });
  });

  it('sends BCeID Business only the guid and reads the BCeID attributes', async () => {
    css.answer(() =>
      json({
        data: [
          {
            username: 'a1b2@bceidbusiness',
            email: 'bob@example.com',
            firstName: 'Bob',
            lastName: '',
            attributes: { bceid_user_guid: ['A1B2'], bceid_username: ['bobco'] },
          },
        ],
      }),
    );

    const result = await new CssUserSearchAdapter(makeConfig()).search({
      identityProvider: 'bceidbusiness',
      filters: { guid: 'A1B2', firstName: 'Bob' },
      limit: 25,
    });

    expect(lookups()[0].path).toBe('/api/v1/test/business-bceid/users');
    expect(Object.fromEntries(lookups()[0].query)).toEqual({ guid: 'A1B2' });
    expect(result.hits[0]).toMatchObject({
      subject: 'a1b2@bceidbusiness',
      guid: 'A1B2',
      username: 'bobco',
      displayName: null,
      lastName: null,
    });
  });

  it('returns at most the limit and says when there were more', async () => {
    css.answer(() =>
      json({ data: ['a', 'b', 'c'].map((id) => ({ ...cssUser, username: `${id}@azureidir` })) }),
    );

    const result = await new CssUserSearchAdapter(makeConfig()).search({
      identityProvider: 'azureidir',
      filters: { lastName: 'Smith' },
      limit: 2,
    });

    expect(result.hits.map((hit) => hit.subject)).toEqual(['a@azureidir', 'b@azureidir']);
    expect(result.truncated).toBe(true);
  });

  it('refreshes a rejected token once within the same search', async () => {
    let rejected = false;
    css.answer(() => {
      if (rejected) return json({ data: [] });
      rejected = true;
      return { status: 401, body: '{}' };
    });

    await new CssUserSearchAdapter(makeConfig()).search({
      identityProvider: 'azureidir',
      filters: { guid: 'F0E1D2C3' },
      limit: 25,
    });

    expect(tokenCalls()).toHaveLength(2);
    expect(lookups().map(({ authorization }) => authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it.each([400, 422])('reports a refused filter (%s) as a validation error', async (status) => {
    css.answer(() => ({ status, body: JSON.stringify({ message: 'upstream-detail' }) }));

    const err = await new CssUserSearchAdapter(makeConfig())
      .search({ identityProvider: 'azureidir', filters: { guid: 'F0E1D2C3' }, limit: 25 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).not.toContain('upstream-detail');
  });

  it.each([
    ['an upstream 403', () => ({ status: 403, body: 'upstream-detail' })],
    ['an upstream 500', () => ({ status: 500, body: 'upstream-detail' })],
    ['a body that is not JSON', () => ({ status: 200, body: '<html>upstream-detail</html>' })],
    ['an unexpected shape', () => json({ data: [{ email: 'upstream-detail' }] })],
  ])('reports %s as unavailable', async (_case, answer) => {
    css.answer(answer);

    const err = await new CssUserSearchAdapter(makeConfig())
      .search({ identityProvider: 'azureidir', filters: { lastName: 'Smith' }, limit: 25 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect((err as Error).message).not.toContain('upstream-detail');
  });

  it('gives up on a stalled lookup within its timeout', async () => {
    css.answer(() => 'stall');

    const err = await new CssUserSearchAdapter(makeConfig({ TIMEOUT_MS: '100' }))
      .search({ identityProvider: 'azureidir', filters: { lastName: 'Smith' }, limit: 25 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableError);
  });

  it('refuses an identity provider it cannot search without calling CSS', async () => {
    const err = await new CssUserSearchAdapter(makeConfig())
      .search({ identityProvider: 'githubpublic', filters: { email: 'x@y.z' }, limit: 25 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(css.requests).toHaveLength(0);
  });

  it('reports readiness from the credential exchange', async () => {
    await expect(new CssUserSearchAdapter(makeConfig()).readinessCheck()).resolves.toEqual({
      ok: true,
    });
    clearOAuth2TokenCache();
    await expect(
      new CssUserSearchAdapter(makeConfig({ TOKEN_URL: `${css.origin}/missing` })).readinessCheck(),
    ).resolves.toEqual({ ok: false, message: 'CSS credential exchange failed' });
  });

  it('refuses a CSS environment it does not know, and missing credentials', () => {
    expect(() => new CssUserSearchAdapter(makeConfig({ ENVIRONMENT: 'staging' }))).toThrow();
    expect(() => new CssUserSearchAdapter(makeConfig({ CLIENT_SECRET: undefined }))).toThrow();
  });
});
