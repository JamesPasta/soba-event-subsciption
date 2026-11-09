import express from 'express';
import request from 'supertest';
import { z } from 'zod';

// Records what each route asks for, and refuses a request that carries x-deny. The real middleware
// resolves permissions from the database, which these tests are not about.
const mockPermissionCalls: string[][] = [];

jest.mock('../../../src/core/middleware/requireFormPermissions', () => {
  const { ForbiddenError } = jest.requireActual('../../../src/core/errors');
  return {
    requireFormPermissions: (required: readonly string[]) => {
      mockPermissionCalls.push([...required]);
      return (req: express.Request, _res: express.Response, next: express.NextFunction) =>
        next(req.get('x-deny') ? new ForbiddenError('Insufficient form permissions') : undefined);
    },
  };
});

jest.mock('../../../src/core/middleware/requireWorkspaceRole', () => {
  const { ForbiddenError } = jest.requireActual('../../../src/core/errors');
  return {
    requireWorkspaceManage: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => next(req.get('x-deny') ? new ForbiddenError('Workspace management required') : undefined),
  };
});

import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';
import { NotFoundError } from '../../../src/core/errors';
import { Permissions } from '../../../src/core/db/codes';
import { assertSaved, SETTINGS_CHANGED } from '../../../src/features/form-settings/saved';
import {
  settingsRoutes,
  type FormSettingsService,
} from '../../../src/features/form-settings/routes';

const BodySchema = z.object({ allowThing: z.boolean() });
type Body = z.infer<typeof BodySchema>;
type Settings = { allowThing: boolean };

const CONTEXT = { actorId: 'a1', workspaceId: 'ws1', actorDisplayLabel: 'Tester' };

const service = {
  get: jest.fn<Promise<Settings>, [unknown, string]>(),
  set: jest.fn<Promise<Settings>, [unknown, string, Body]>(),
};
const typedService = service as unknown as FormSettingsService<Settings, Body>;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.coreContext = CONTEXT as unknown as NonNullable<typeof req.coreContext>;
  next();
});
app.use('/forms/:id/settings/group', settingsRoutes(typedService, BodySchema));
app.use('/workspaces/:id/settings/group', settingsRoutes(typedService, BodySchema, 'workspace'));
app.use(coreErrorHandler);

describe('settingsRoutes', () => {
  beforeEach(() => {
    service.get.mockReset();
    service.set.mockReset();
  });

  it('gates a form group on form_read and form_update, and a workspace level on neither', () => {
    expect(mockPermissionCalls).toEqual([[Permissions.form_read], [Permissions.form_update]]);
  });

  it('reads the group for the form in the request', async () => {
    service.get.mockResolvedValue({ allowThing: true });

    const res = await request(app).get('/forms/f1/settings/group');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ allowThing: true });
    expect(service.get).toHaveBeenCalledWith(CONTEXT, 'f1');
  });

  it('saves the validated body', async () => {
    service.set.mockResolvedValue({ allowThing: false });

    const res = await request(app).put('/forms/f1/settings/group').send({ allowThing: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ allowThing: false });
    expect(service.set).toHaveBeenCalledWith(CONTEXT, 'f1', { allowThing: false });
  });

  it('rejects a body the schema refuses without reaching the service', async () => {
    const res = await request(app).put('/forms/f1/settings/group').send({ allowThing: 'yes' });

    expect(res.status).toBe(400);
    expect(service.set).not.toHaveBeenCalled();
  });

  it('rejects a body missing a setting', async () => {
    const res = await request(app).put('/forms/f1/settings/group').send({});

    expect(res.status).toBe(400);
    expect(service.set).not.toHaveBeenCalled();
  });

  // A caller who may not write learns nothing about the body from a validation error.
  it.each(['/forms/f1/settings/group', '/workspaces/ws1/settings/group'])(
    'refuses a write at %s before reading the body',
    async (path) => {
      const res = await request(app).put(path).set('x-deny', '1').send({ allowThing: 'yes' });

      expect(res.status).toBe(403);
      expect(service.set).not.toHaveBeenCalled();
    },
  );

  // Resolving the workspace has already checked membership, so reading needs nothing more.
  it('lets a workspace member read the workspace level', async () => {
    service.get.mockResolvedValue({ allowThing: true });

    const res = await request(app).get('/workspaces/ws1/settings/group').set('x-deny', '1');

    expect(res.status).toBe(200);
    expect(service.get).toHaveBeenCalledWith(CONTEXT, 'ws1');
  });

  it('saves the workspace level for an owner or admin', async () => {
    service.set.mockResolvedValue({ allowThing: true });

    const res = await request(app).put('/workspaces/ws1/settings/group').send({ allowThing: true });

    expect(res.status).toBe(200);
    expect(service.set).toHaveBeenCalledWith(CONTEXT, 'ws1', { allowThing: true });
  });

  it('reports a missing row as 404', async () => {
    service.get.mockRejectedValue(new NotFoundError('Form settings not found'));

    const res = await request(app).get('/forms/f1/settings/group');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Form settings not found' });
  });

  it.each([
    ['notFound', 404, 'Form settings not found'],
    ['conflict', 409, SETTINGS_CHANGED],
  ] as const)('reports a save that ended %s as %i', async (status, code, error) => {
    service.set.mockImplementation(async () => {
      assertSaved(status, 'Form settings not found');
      return { allowThing: true };
    });

    const res = await request(app).put('/forms/f1/settings/group').send({ allowThing: true });

    expect(res.status).toBe(code);
    expect(res.body).toEqual({ error });
  });
});
