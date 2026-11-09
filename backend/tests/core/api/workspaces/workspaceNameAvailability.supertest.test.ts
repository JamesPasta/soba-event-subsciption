jest.mock('../../../../src/core/api/workspaces/service', () => ({
  workspacesApiService: { checkNameAvailable: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import { workspacesRouter } from '../../../../src/core/api/workspaces/route';
import { workspacesApiService } from '../../../../src/core/api/workspaces/service';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';
import { ForbiddenError } from '../../../../src/core/errors';

const checkNameAvailable = jest.mocked(workspacesApiService.checkNameAvailable);

// Stands in for checkJwt + resolveActor, which need a signed token; everything after is real,
// including query validation and the error -> HTTP status mapping.
const app = express();
app.use((req, _res, next) => {
  req.user = { providerCode: 'idir', idpAttributes: {} } as unknown as Express.User;
  req.actorId = 'actor-1';
  next();
});
app.use('/', workspacesRouter);
app.use(coreErrorHandler);

const ROUTE = '/workspaces/name-availability';
const EXCLUDE_ID = '01a0f8f4-0625-701d-a41e-648bc7ae9c7e';

describe('GET /workspaces/name-availability', () => {
  beforeEach(() => {
    checkNameAvailable.mockReset();
  });

  it('returns the service result for a valid query', async () => {
    checkNameAvailable.mockResolvedValue({ available: true });

    const res = await request(app).get(ROUTE).query({ org: 'HLTH', name: 'Health Permits' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
    expect(checkNameAvailable).toHaveBeenCalledWith(
      'actor-1',
      'idir',
      'HLTH',
      'Health Permits',
      undefined,
    );
  });

  it('passes excludeId through when editing an existing workspace', async () => {
    checkNameAvailable.mockResolvedValue({ available: false });

    const res = await request(app)
      .get(ROUTE)
      .query({ org: 'HLTH', name: 'Health Permits', excludeId: EXCLUDE_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
    expect(checkNameAvailable).toHaveBeenCalledWith(
      'actor-1',
      'idir',
      'HLTH',
      'Health Permits',
      EXCLUDE_ID,
    );
  });

  it('rejects a request missing org or name with 400, without calling the service', async () => {
    const res = await request(app).get(ROUTE).query({ name: 'Health Permits' });

    expect(res.status).toBe(400);
    expect(checkNameAvailable).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid excludeId with 400, without calling the service', async () => {
    const res = await request(app)
      .get(ROUTE)
      .query({ org: 'HLTH', name: 'Health Permits', excludeId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(checkNameAvailable).not.toHaveBeenCalled();
  });

  it('surfaces 403 when the service refuses the caller', async () => {
    checkNameAvailable.mockRejectedValue(
      new ForbiddenError('Only workspace owners or admins can manage this workspace'),
    );

    const res = await request(app)
      .get(ROUTE)
      .query({ org: 'HLTH', name: 'Health Permits', excludeId: EXCLUDE_ID });

    expect(res.status).toBe(403);
  });
});
