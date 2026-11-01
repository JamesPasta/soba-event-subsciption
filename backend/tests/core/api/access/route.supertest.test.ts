import express from 'express';
import request from 'supertest';

// Stands in for workspace resolution, which reads the membership from the database: the caller's
// membership role comes from a test header.
jest.mock('../../../../src/core/middleware/workspaceContext', () => {
  const resolve = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.coreContext = {
      workspaceId: 'ws1',
      actorId: 'actor1',
      actorDisplayLabel: 'Actor One',
      workspaceSource: 'test',
      role: req.header('x-test-role') ?? 'admin',
    };
    next();
  };
  return { workspaceFromResource: () => resolve, workspaceFromQuery: resolve };
});
jest.mock('../../../../src/core/api/access/service', () => ({
  accessApiService: {
    list: jest.fn(),
    get: jest.fn(),
    add: jest.fn(),
    setGroups: jest.fn(),
    remove: jest.fn(),
  },
}));

import { accessRouter } from '../../../../src/core/api/access';
import { accessApiService } from '../../../../src/core/api/access/service';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';

const WORKSPACE = '01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c0d';
const MEMBERS = `/workspaces/${WORKSPACE}/members`;
const MEMBER = `${MEMBERS}/m-1`;
const GROUP_ID = '01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c01';
const USER_ID = '01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c02';

const app = express();
app.use(express.json());
app.use('/', accessRouter);
app.use(coreErrorHandler);

const service = jest.mocked(accessApiService);

describe('workspace access routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.list.mockResolvedValue({ items: [] } as never);
    service.get.mockResolvedValue({ membershipId: 'm-1' } as never);
    service.add.mockResolvedValue({ membershipId: 'm-1' } as never);
    service.setGroups.mockResolvedValue({ membershipId: 'm-1' } as never);
    service.remove.mockResolvedValue(undefined);
  });

  it('defaults the list to people in a group, first page by name', async () => {
    const res = await request(app).get(MEMBERS);
    expect(res.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', actorId: 'actor1' }),
      expect.objectContaining({
        offset: 0,
        limit: 20,
        sort: 'displayLabel:asc',
        include: 'grouped',
      }),
    );
  });

  it('passes the include filter and a trimmed search', async () => {
    await request(app).get(`${MEMBERS}?include=all&q=%20rita%20`);
    expect(service.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ include: 'all', q: 'rita' }),
    );
  });

  it.each([
    ['an unknown include', 'include=none'],
    ['an undeclared sort', 'sort=email:asc'],
  ])('rejects %s on the list', async (_label, query) => {
    expect((await request(app).get(`${MEMBERS}?${query}`)).status).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
  });

  it.each(['member', 'viewer'])('refuses a %s every read and write', async (role) => {
    const calls = [
      request(app).get(MEMBERS),
      request(app).get(MEMBER),
      request(app)
        .post(MEMBERS)
        .send({ userId: USER_ID, groupIds: [GROUP_ID] }),
      request(app)
        .put(`${MEMBER}/groups`)
        .send({ groupIds: [GROUP_ID] }),
      request(app).delete(MEMBER),
    ];
    for (const call of calls) {
      expect((await call.set('x-test-role', role)).status).toBe(403);
    }
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])('lets a %s read one member', async (role) => {
    expect((await request(app).get(MEMBER).set('x-test-role', role)).status).toBe(200);
    expect(service.get).toHaveBeenCalledWith(expect.anything(), 'm-1');
  });

  it('adds with the ids in lower case', async () => {
    const res = await request(app)
      .post(MEMBERS)
      .send({ userId: USER_ID.toUpperCase(), groupIds: [GROUP_ID.toUpperCase()] });
    expect(res.status).toBe(201);
    expect(service.add).toHaveBeenCalledWith(expect.anything(), {
      userId: USER_ID,
      groupIds: [GROUP_ID],
    });
  });

  it.each([
    ['no groups', { userId: USER_ID, groupIds: [] }],
    ['a group id that is not a uuid', { userId: USER_ID, groupIds: ['grp-1'] }],
    ['no user', { groupIds: [GROUP_ID] }],
  ])('rejects an add with %s', async (_label, body) => {
    expect((await request(app).post(MEMBERS).send(body)).status).toBe(400);
    expect(service.add).not.toHaveBeenCalled();
  });

  it("replaces a member's groups", async () => {
    const res = await request(app)
      .put(`${MEMBER}/groups`)
      .send({ groupIds: [GROUP_ID] });
    expect(res.status).toBe(200);
    expect(service.setGroups).toHaveBeenCalledWith(expect.anything(), 'm-1', [GROUP_ID]);
  });

  it('removes a member with no body', async () => {
    expect((await request(app).delete(MEMBER)).status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(expect.anything(), 'm-1');
  });
});
