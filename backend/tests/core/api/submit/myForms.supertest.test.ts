jest.mock('../../../../src/core/container', () => ({
  formsApiService: { listMine: jest.fn() },
  formVersionService: {},
  submissionsApiService: {},
}));
jest.mock('../../../../src/core/api/workspaces/service', () => ({
  workspacesApiService: { listMine: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import { submitRouter } from '../../../../src/core/api/submit';
import { workspacesApiService } from '../../../../src/core/api/workspaces/service';
import { formsApiService } from '../../../../src/core/container';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';

const listForms = jest.mocked(formsApiService.listMine);
const listWorkspaces = jest.mocked(workspacesApiService.listMine);

// Stands in for checkJwt + resolveActorOrPublic, which need a signed token; everything after is real.
function buildApp(caller: 'signedIn' | 'anonymous') {
  const app = express();
  app.use((req, _res, next) => {
    if (caller === 'signedIn') {
      req.user = { providerCode: 'idir', idpAttributes: {} } as unknown as Express.User;
      req.actorId = 'actor-1';
    } else {
      req.actorId = 'public-user';
      req.idpType = 'public';
    }
    next();
  });
  app.use('/api/v1/submit', submitRouter);
  app.use(coreErrorHandler);
  return app;
}

const FORMS = '/api/v1/submit/forms/mine';
const WORKSPACES = '/api/v1/submit/workspaces/mine';
const WORKSPACE_ID = '01a0f8f4-0625-701d-a41e-648bc7ae9c7e';

const PAGE = {
  items: [],
  page: { offset: 0, limit: 20, total: 0 },
  filters: {},
  sort: 'name:asc' as const,
};
const LOOKUP = { items: [], limit: 500, truncated: false };

beforeEach(() => {
  listForms.mockReset().mockResolvedValue(PAGE);
  listWorkspaces.mockReset().mockResolvedValue(LOOKUP);
});

describe('GET /submit/forms/mine', () => {
  it("lists the caller's forms by name, never a user named in the query", async () => {
    const res = await request(buildApp('signedIn'))
      .get(FORMS)
      .query({ workspaceId: WORKSPACE_ID, q: 'permit', userId: 'someone-else' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(PAGE);
    expect(listForms).toHaveBeenCalledWith('actor-1', {
      offset: 0,
      limit: 20,
      workspaceId: WORKSPACE_ID,
      q: 'permit',
      sort: 'name:asc',
      locale: 'en',
    });
  });

  it('sorts in the language the caller asks for', async () => {
    await request(buildApp('signedIn'))
      .get(FORMS)
      .set('Accept-Language', 'fr-CA')
      .query({ sort: 'name:desc' });

    expect(listForms).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sort: 'name:desc', locale: 'fr' }),
    );
  });

  // Anonymous callers resolve to the shared public user, which owns every anonymous submission.
  it('refuses an anonymous caller', async () => {
    const res = await request(buildApp('anonymous')).get(FORMS);

    expect(res.status).toBe(401);
    expect(listForms).not.toHaveBeenCalled();
  });

  it.each([
    ['a workspace id that is not a uuid', { workspaceId: 'mine' }],
    ['a cursor', { cursor: 'abc' }],
    ['a sort the list does not offer', { sort: 'updatedAt:desc' }],
  ])('refuses %s', async (_label, params) => {
    const res = await request(buildApp('signedIn')).get(FORMS).query(params);

    expect(res.status).toBe(400);
    expect(listForms).not.toHaveBeenCalled();
  });
});

describe('GET /submit/workspaces/mine', () => {
  it("lists the caller's workspaces in the caller's language", async () => {
    const res = await request(buildApp('signedIn'))
      .get(WORKSPACES)
      .set('Accept-Language', 'fr')
      .query({ userId: 'someone-else' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(LOOKUP);
    expect(listWorkspaces).toHaveBeenCalledWith('actor-1', 'fr');
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(buildApp('anonymous')).get(WORKSPACES);

    expect(res.status).toBe(401);
    expect(listWorkspaces).not.toHaveBeenCalled();
  });
});
