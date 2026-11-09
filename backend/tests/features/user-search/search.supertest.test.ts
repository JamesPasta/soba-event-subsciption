import express from 'express';
import request from 'supertest';

// Workspace resolution and the database reads are stubbed; the route, access check, service,
// registry and css-v1 run for real against a CSS stand-in.
jest.mock('../../../src/core/middleware/workspaceContext', () => ({
  workspaceFromResource:
    (config: { kind: string }) =>
    (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.coreContext = {
        workspaceId: 'ws1',
        actorId: 'actor1',
        actorDisplayLabel: 'Actor One',
        workspaceSource: 'test',
        role: 'owner',
        ...(config.kind === 'form' ? { formId: req.params.id } : {}),
      };
      next();
    },
}));
jest.mock('../../../src/core/db/repos/featureRepo', () => ({
  isFeatureEnabledCached: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../src/core/db/repos/identityProviderRepo', () => ({
  listLoginIdentityProviders: jest.fn().mockResolvedValue([
    { code: 'azureidir', name: 'IDIR - MFA' },
    { code: 'bceidbusiness', name: 'BCeID Business' },
  ]),
}));
jest.mock('../../../src/core/db/repos/identityLookup', () => ({
  findIdentityOwners: jest.fn(),
}));

import { findIdentityOwners } from '../../../src/core/db/repos/identityLookup';
import { clearOAuth2TokenCache } from '../../../src/core/auth/oauth2TokenProvider';
import { formUserSearchRouter } from '../../../src/features/user-search';
import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';
import { json, startCss, type FakeCss } from '../../plugins/css-v1/fakeCss';

const app = express();
app.use('/forms/:id/user-search', formUserSearchRouter);
app.use(coreErrorHandler);

const SEARCH = '/forms/form-1/user-search';

const cssUser = {
  username: 'f0e1d2c3@azureidir',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Smith',
  attributes: { display_name: ['Smith, Alice CITZ:EX'], idir_user_guid: ['F0E1D2C3'] },
};

describe('user search through css-v1', () => {
  const saved = { ...process.env };
  let css: FakeCss;
  const lookups = () => css.requests.filter(({ path }) => path !== '/token');

  beforeEach(async () => {
    css = await startCss();
    css.answer(() => json({ data: [cssUser] }));
    Object.assign(process.env, {
      USER_SEARCH_PLUGINS: 'css-v1',
      PLUGIN_CSS_V1_API_BASE_URL: `${css.origin}/api/v1`,
      PLUGIN_CSS_V1_ENVIRONMENT: 'test',
      PLUGIN_CSS_V1_TOKEN_URL: `${css.origin}/token`,
      PLUGIN_CSS_V1_CLIENT_ID: 'css-client',
      PLUGIN_CSS_V1_CLIENT_SECRET: 'css-secret',
    });
    jest.mocked(findIdentityOwners).mockResolvedValue([]);
  });

  afterEach(async () => {
    process.env = { ...saved };
    clearOAuth2TokenCache();
    await css.close();
  });

  it('finds people in CSS and marks the ones who are Soba users', async () => {
    jest
      .mocked(findIdentityOwners)
      .mockResolvedValue([
        { identityProvider: 'azureidir', subject: 'F0E1D2C3@azureidir', userId: 'user-a' },
      ]);

    const res = await request(app).get(
      `${SEARCH}?identityProvider=azureidir&lastName=Smith&locale=fr`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      users: [
        {
          identityProvider: 'azureidir',
          subject: 'f0e1d2c3@azureidir',
          guid: 'F0E1D2C3',
          username: null,
          displayName: 'Smith, Alice CITZ:EX',
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
          sobaUserId: 'user-a',
          sources: ['css-v1'],
        },
      ],
      truncated: false,
      plugins: [{ code: 'css-v1', status: 'ok', truncated: false }],
    });
    expect(lookups()).toHaveLength(1);
    expect(lookups()[0].path).toBe('/api/v1/test/azure-idir/users');
    expect(Object.fromEntries(lookups()[0].query)).toEqual({ lastName: 'Smith' });
    expect(lookups()[0].authorization).toBe('Bearer token-1');
  });

  it('answers 503 when CSS cannot answer, and 400 when CSS refuses the filters', async () => {
    css.answer(() => ({ status: 500, body: 'upstream-detail' }));
    const unavailable = await request(app).get(`${SEARCH}?guid=F0E1D2C3`);
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(unavailable.body)).not.toContain('upstream-detail');

    css.answer(() => ({ status: 400, body: 'upstream-detail' }));
    const refused = await request(app).get(`${SEARCH}?guid=F0E1D2C3`);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).not.toContain('upstream-detail');
  });

  it('searches every account type CSS can look up by the filter when none is given', async () => {
    css.answer(() => json({ data: [] }));
    const lookupPaths = () => new Set(lookups().map(({ path }) => path));

    const byName = await request(app).get(`${SEARCH}?lastName=Smith`);
    expect(byName.status).toBe(200);
    expect(lookupPaths()).toEqual(new Set(['/api/v1/test/azure-idir/users']));

    const byGuid = await request(app).get(`${SEARCH}?guid=F0E1D2C3`);
    expect(byGuid.status).toBe(200);
    expect(lookupPaths()).toEqual(
      new Set(['/api/v1/test/azure-idir/users', '/api/v1/test/business-bceid/users']),
    );
    expect(lookups()).toHaveLength(3);
  });

  it('refuses a BCeID Business name search without calling CSS', async () => {
    const res = await request(app).get(`${SEARCH}?identityProvider=bceidbusiness&lastName=Smith`);

    expect(res.status).toBe(400);
    expect(lookups()).toHaveLength(0);
  });

  it('answers 503 when the enabled plugin is missing its config', async () => {
    delete process.env.PLUGIN_CSS_V1_CLIENT_SECRET;

    const res = await request(app).get(`${SEARCH}?lastName=Smith`);

    expect(res.status).toBe(503);
    expect(css.requests).toHaveLength(0);
  });

  it('lists what css-v1 can search', async () => {
    const res = await request(app).get(`${SEARCH}/capabilities`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      identityProviders: [
        {
          code: 'azureidir',
          name: 'IDIR - MFA',
          fields: ['email', 'firstName', 'lastName', 'guid'],
        },
        { code: 'bceidbusiness', name: 'BCeID Business', fields: ['guid'] },
      ],
    });
  });
});
