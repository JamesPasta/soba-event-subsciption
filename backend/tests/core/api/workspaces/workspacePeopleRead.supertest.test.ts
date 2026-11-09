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
      role: req.header('x-test-role') ?? 'member',
    };
    next();
  };
  return { workspaceFromResource: () => resolve, workspaceFromQuery: resolve };
});
jest.mock('../../../../src/core/api/groups/service', () => ({
  groupsApiService: { list: jest.fn(), get: jest.fn(), create: jest.fn() },
}));
jest.mock('../../../../src/core/api/members/service', () => ({
  membersApiService: { list: jest.fn() },
}));

import { groupsRouter } from '../../../../src/core/api/groups';
import { membersRouter } from '../../../../src/core/api/members';
import { groupsApiService } from '../../../../src/core/api/groups/service';
import { membersApiService } from '../../../../src/core/api/members/service';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';

const WORKSPACE = '01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c0d';
const GROUPS = `/workspaces/${WORKSPACE}/groups`;
const MEMBERS = `/members?workspaceId=${WORKSPACE}`;

const app = express();
app.use(express.json());
app.use('/members', membersRouter);
app.use('/', groupsRouter);
app.use(coreErrorHandler);

const mockListGroups = jest.mocked(groupsApiService.list);
const mockGetGroup = jest.mocked(groupsApiService.get);
const mockCreateGroup = jest.mocked(groupsApiService.create);
const GROUP = `${GROUPS}/grp-1`;
const mockListMembers = jest.mocked(membersApiService.list);

describe("reading a workspace's members and groups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListGroups.mockResolvedValue({ items: [] } as never);
    mockGetGroup.mockResolvedValue({ id: 'grp-1' } as never);
    mockListMembers.mockResolvedValue({ items: [] } as never);
  });

  it('pages, searches and sorts the groups list from the query', async () => {
    const res = await request(app)
      .get(`${GROUPS}?offset=10&limit=5&sort=name:desc&q=%20review%20`)
      .set('x-test-role', 'member');
    expect(res.status).toBe(200);
    expect(mockListGroups).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1' }),
      expect.objectContaining({ offset: 10, limit: 5, sort: 'name:desc', q: 'review' }),
    );
  });

  it('defaults the groups list to the first page by name', async () => {
    await request(app).get(GROUPS).set('x-test-role', 'member');
    expect(mockListGroups).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ offset: 0, limit: 20, sort: 'name:asc' }),
    );
  });

  it.each([
    ['an undeclared sort', 'sort=description:asc'],
    ['a cursor', 'cursor=abc'],
  ])('rejects %s on the groups list', async (_label, query) => {
    const res = await request(app).get(`${GROUPS}?${query}`).set('x-test-role', 'member');
    expect(res.status).toBe(400);
    expect(mockListGroups).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'member'])('lets a %s read one group', async (role) => {
    const res = await request(app).get(GROUP).set('x-test-role', role);
    expect(res.status).toBe(200);
    expect(mockGetGroup).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1' }),
      'grp-1',
    );
  });

  it('refuses a viewer one group without reading it', async () => {
    expect((await request(app).get(GROUP).set('x-test-role', 'viewer')).status).toBe(403);
    expect(mockGetGroup).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'member'])('lets a %s list groups and members', async (role) => {
    expect((await request(app).get(GROUPS).set('x-test-role', role)).status).toBe(200);
    expect((await request(app).get(MEMBERS).set('x-test-role', role)).status).toBe(200);
    expect(mockListGroups).toHaveBeenCalled();
    expect(mockListMembers).toHaveBeenCalled();
  });

  it('refuses a viewer both lists without reading them', async () => {
    expect((await request(app).get(GROUPS).set('x-test-role', 'viewer')).status).toBe(403);
    expect((await request(app).get(MEMBERS).set('x-test-role', 'viewer')).status).toBe(403);
    expect(mockListGroups).not.toHaveBeenCalled();
    expect(mockListMembers).not.toHaveBeenCalled();
  });

  it('needs an owner or admin to create a group', async () => {
    const res = await request(app)
      .post(GROUPS)
      .set('x-test-role', 'member')
      .send({ name: 'Reviewers', roleCodes: ['submission_reviewer'] });
    expect(res.status).toBe(403);
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });
});
