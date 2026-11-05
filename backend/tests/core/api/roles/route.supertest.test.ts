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
  roleNameExistsInWorkspace: jest.fn(),
  createWorkspaceRole: jest.fn(),
  updateWorkspaceRole: jest.fn(),
  softDeleteWorkspaceRole: jest.fn(),
}));

import { rolesRouter } from '../../../../src/core/api/roles';
import { ConflictError } from '../../../../src/core/errors';
import {
  createWorkspaceRole,
  listPermissionCodesByRole,
  listRolesForWorkspace,
  roleNameExistsInWorkspace,
  softDeleteWorkspaceRole,
  updateWorkspaceRole,
} from '../../../../src/core/db/repos/roleRepo';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';

const ROLES = '/workspaces/01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c0d/roles';
const ROLE = `${ROLES}/custom-1`;
const ACTOR = { workspaceId: 'ws1', actorId: 'actor1', actorDisplayLabel: 'Actor One' };
const AUDITOR = { code: 'custom-1', name: 'Auditor', workspaceId: 'ws1' };
const NEW_ROLE = { name: '  Auditor  ', permissionCodes: ['submission_read', 'form_create'] };

const app = express();
app.use(express.json());
app.use('/', rolesRouter);
app.use(coreErrorHandler);

describe('workspace role routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(listRolesForWorkspace)
      .mockResolvedValue([
        { code: 'form_admin', name: 'Form admin', workspaceId: null },
        { code: 'team_manager', name: 'Team manager', workspaceId: null },
        AUDITOR,
        { code: 'custom-2', name: 'Empty role', workspaceId: 'ws1' },
      ] as never);
    jest.mocked(listPermissionCodesByRole).mockResolvedValue(
      new Map([
        ['form_admin', ['*']],
        ['team_manager', ['form_read', 'team_read', 'team_update']],
        ['custom-1', ['submission_read']],
      ]),
    );
    jest.mocked(roleNameExistsInWorkspace).mockResolvedValue(false);
    jest.mocked(createWorkspaceRole).mockResolvedValue('custom-1');
    jest.mocked(updateWorkspaceRole).mockResolvedValue(undefined);
    jest.mocked(softDeleteWorkspaceRole).mockResolvedValue(undefined);
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

  it('reads one role', async () => {
    jest.mocked(listRolesForWorkspace).mockResolvedValue([AUDITOR] as never);
    const res = await request(app).get(ROLE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      roleCode: 'custom-1',
      name: 'Auditor',
      system: false,
      permissions: ['submission_read'],
    });
    expect(listRolesForWorkspace).toHaveBeenCalledWith('ws1', ['custom-1']);
  });

  it('answers 404 for a role the workspace cannot use', async () => {
    jest.mocked(listRolesForWorkspace).mockResolvedValue([]);
    expect((await request(app).get(ROLE)).status).toBe(404);
  });

  it('refuses a viewer every read', async () => {
    const list = await request(app).get(ROLES).set('x-test-role', 'viewer');
    const one = await request(app).get(ROLE).set('x-test-role', 'viewer');
    expect([list.status, one.status]).toEqual([403, 403]);
    expect(listRolesForWorkspace).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])('creates a role for a %s, as that actor', async (role) => {
    jest.mocked(listRolesForWorkspace).mockResolvedValue([AUDITOR] as never);
    const res = await request(app).post(ROLES).set('x-test-role', role).send(NEW_ROLE);
    expect(res.status).toBe(201);
    expect(res.body.roleCode).toBe('custom-1');
    expect(createWorkspaceRole).toHaveBeenCalledWith(
      expect.objectContaining(ACTOR),
      expect.objectContaining({ name: 'Auditor', permissionCodes: NEW_ROLE.permissionCodes }),
    );
  });

  it.each([
    ['the wildcard', { name: 'Auditor', permissionCodes: ['*'] }],
    ['an unknown permission', { name: 'Auditor', permissionCodes: ['nope'] }],
    ['no permissions', { name: 'Auditor', permissionCodes: [] }],
    ['a blank name', { name: '   ', permissionCodes: ['form_read'] }],
    ['a name over the limit', { name: 'x'.repeat(101), permissionCodes: ['form_read'] }],
  ])('rejects creating with %s', async (_label, invalid) => {
    expect((await request(app).post(ROLES).send(invalid)).status).toBe(400);
    expect(createWorkspaceRole).not.toHaveBeenCalled();
  });

  it('refuses to create under a name in use, with a code', async () => {
    jest.mocked(roleNameExistsInWorkspace).mockResolvedValue(true);
    const res = await request(app).post(ROLES).send(NEW_ROLE);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('role_name_taken');
    expect(createWorkspaceRole).not.toHaveBeenCalled();
  });

  it('passes on only what an update sent', async () => {
    jest.mocked(listRolesForWorkspace).mockResolvedValue([AUDITOR] as never);
    const res = await request(app)
      .patch(ROLE)
      .send({ permissionCodes: ['form_read'] });
    expect(res.status).toBe(200);
    expect(updateWorkspaceRole).toHaveBeenCalledWith(expect.objectContaining(ACTOR), 'custom-1', {
      permissionCodes: ['form_read'],
    });
    expect(roleNameExistsInWorkspace).not.toHaveBeenCalled();
  });

  it("lets a role keep its own name, and checks it against the others'", async () => {
    jest.mocked(listRolesForWorkspace).mockResolvedValue([AUDITOR] as never);
    await request(app).patch(ROLE).send({ name: 'Auditor' });
    expect(roleNameExistsInWorkspace).toHaveBeenCalledWith('ws1', 'Auditor', 'custom-1');
  });

  it.each([
    ['nothing to change', {}],
    ['the wildcard', { permissionCodes: ['*'] }],
    ['no permissions', { permissionCodes: [] }],
  ])('rejects updating with %s', async (_label, invalid) => {
    expect((await request(app).patch(ROLE).send(invalid)).status).toBe(400);
    expect(updateWorkspaceRole).not.toHaveBeenCalled();
  });

  it('answers 204 to a delete', async () => {
    expect((await request(app).delete(ROLE)).status).toBe(204);
    expect(softDeleteWorkspaceRole).toHaveBeenCalledWith(
      expect.objectContaining(ACTOR),
      'custom-1',
    );
  });

  it('reports a role still on a group, with a code', async () => {
    jest
      .mocked(softDeleteWorkspaceRole)
      .mockRejectedValue(new ConflictError('In use', 'role_in_use'));
    const res = await request(app).delete(ROLE);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('role_in_use');
  });

  it.each(['member', 'viewer'])('refuses a %s every write', async (role) => {
    const statuses = await Promise.all([
      request(app)
        .post(ROLES)
        .set('x-test-role', role)
        .send({ name: 'Auditor', permissionCodes: ['form_read'] }),
      request(app).patch(ROLE).set('x-test-role', role).send({ name: 'Auditor' }),
      request(app).delete(ROLE).set('x-test-role', role),
    ]);
    expect(statuses.map((res) => res.status)).toEqual([403, 403, 403]);
    expect(createWorkspaceRole).not.toHaveBeenCalled();
    expect(updateWorkspaceRole).not.toHaveBeenCalled();
    expect(softDeleteWorkspaceRole).not.toHaveBeenCalled();
  });
});
