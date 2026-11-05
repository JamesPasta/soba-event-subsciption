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
  return { workspaceFromResource: () => resolve };
});
jest.mock('../../../../src/core/db/repos/roleRepo', () => ({
  listRolesForWorkspace: jest.fn(),
  listPermissionCodesByRole: jest.fn(),
}));

import { rolesRouter } from '../../../../src/core/api/roles';
import {
  listPermissionCodesByRole,
  listRolesForWorkspace,
} from '../../../../src/core/db/repos/roleRepo';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';

const ROLES = '/workspaces/01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c0d/roles';

const app = express();
app.use('/', rolesRouter);
app.use(coreErrorHandler);

describe('workspace role routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(listRolesForWorkspace).mockResolvedValue([
      { code: 'form_admin', name: 'Form admin', workspaceId: null },
      { code: 'team_manager', name: 'Team manager', workspaceId: null },
      { code: 'custom-1', name: 'Auditor', workspaceId: 'ws1' },
      { code: 'custom-2', name: 'Empty role', workspaceId: 'ws1' },
    ] as never);
    jest.mocked(listPermissionCodesByRole).mockResolvedValue(
      new Map([
        ['form_admin', ['*']],
        ['team_manager', ['form_read', 'team_read', 'team_update']],
        ['custom-1', ['submission_read']],
      ]),
    );
  });

  it.each(['owner', 'admin', 'member'])(
    'lists fixed and custom roles with permissions for a %s',
    async (role) => {
      const res = await request(app).get(ROLES).set('x-test-role', role);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        { roleCode: 'form_admin', name: 'Form admin', system: true, permissions: ['*'] },
        {
          roleCode: 'team_manager',
          name: 'Team manager',
          system: true,
          permissions: ['form_read', 'team_read', 'team_update'],
        },
        { roleCode: 'custom-1', name: 'Auditor', system: false, permissions: ['submission_read'] },
        { roleCode: 'custom-2', name: 'Empty role', system: false, permissions: [] },
      ]);
    },
  );

  it("reads the caller's workspace, never one named by the client", async () => {
    await request(app).get(ROLES);
    expect(listRolesForWorkspace).toHaveBeenCalledWith('ws1');
  });

  it('refuses a viewer', async () => {
    const res = await request(app).get(ROLES).set('x-test-role', 'viewer');
    expect(res.status).toBe(403);
    expect(listRolesForWorkspace).not.toHaveBeenCalled();
  });
});
