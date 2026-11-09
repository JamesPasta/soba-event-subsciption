jest.mock('../../../../src/core/container', () => ({
  submissionsApiService: { listMine: jest.fn() },
  formVersionService: {},
}));

import express from 'express';
import request from 'supertest';
import { submitRouter } from '../../../../src/core/api/submit';
import { submissionsApiService } from '../../../../src/core/container';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';

const listMine = jest.mocked(submissionsApiService.listMine);

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

const MINE = '/api/v1/submit/submissions/mine';

const PAGE = {
  items: [],
  forms: [],
  page: { offset: 0, limit: 20, total: 0 },
  filters: {},
  sort: 'updatedAt:desc' as const,
};

beforeEach(() => {
  listMine.mockReset().mockResolvedValue(PAGE);
});

describe('GET /submit/submissions/mine', () => {
  it("lists the caller's own submissions, never a user named in the query", async () => {
    const res = await request(buildApp('signedIn'))
      .get(MINE)
      .query({ workflowState: 'draft', q: 'tax', userId: 'someone-else' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(PAGE);
    expect(listMine).toHaveBeenCalledWith('actor-1', {
      offset: 0,
      limit: 20,
      workflowState: 'draft',
      q: 'tax',
      sort: 'updatedAt:desc',
      locale: 'en',
    });
  });

  it('sorts in the language the caller asks for', async () => {
    await request(buildApp('signedIn'))
      .get(MINE)
      .set('Accept-Language', 'fr-CA')
      .query({ sort: 'formName:asc' });

    expect(listMine).toHaveBeenCalledWith(
      'actor-1',
      expect.objectContaining({ sort: 'formName:asc', locale: 'fr' }),
    );
  });

  // Anonymous callers resolve to the shared public user, which owns every anonymous submission.
  it('refuses an anonymous caller', async () => {
    const res = await request(buildApp('anonymous')).get(MINE);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
    expect(listMine).not.toHaveBeenCalled();
  });

  it.each([
    ['an opened state', { workflowState: 'opened' }],
    ['a deleted state', { workflowState: 'deleted' }],
    ['a cursor', { cursor: 'abc' }],
    ['an unknown sort', { sort: 'confirmationCode:asc' }],
  ])('refuses %s', async (_label, params) => {
    const res = await request(buildApp('signedIn')).get(MINE).query(params);

    expect(res.status).toBe(400);
    expect(listMine).not.toHaveBeenCalled();
  });
});
