import express from 'express';
import request from 'supertest';

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

jest.mock('../../../src/features/post-submission/settings/service', () => ({
  listActions: jest.fn(),
  getAction: jest.fn(),
  setFormAction: jest.fn(),
  setWorkspaceAction: jest.fn(),
}));

import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';
import { Permissions } from '../../../src/core/db/codes';
import * as service from '../../../src/features/post-submission/settings/service';
import { postSubmissionSettingsRouter } from '../../../src/features/post-submission/settings/routes';

const listActions = service.listActions as jest.Mock;
const getAction = service.getAction as jest.Mock;
const setFormAction = service.setFormAction as jest.Mock;
const setWorkspaceAction = service.setWorkspaceAction as jest.Mock;

const CONTEXT = { actorId: 'a1', workspaceId: 'ws1', actorDisplayLabel: 'Tester' };
const CODE = 'post-submission-email';
const VALUES = { enabled: true, options: { to: ['a@example.com'] } };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.coreContext = CONTEXT as unknown as NonNullable<typeof req.coreContext>;
  next();
});
app.use('/forms/:id/settings/post-submission', postSubmissionSettingsRouter('form'));
app.use('/workspaces/:id/settings/post-submission', postSubmissionSettingsRouter('workspace'));
app.use(coreErrorHandler);

describe('postSubmissionSettingsRouter', () => {
  beforeEach(() => {
    listActions.mockReset().mockResolvedValue({ actions: [] });
    getAction.mockReset().mockResolvedValue({ values: VALUES, version: 1 });
    setFormAction.mockReset().mockResolvedValue({ inherit: true });
    setWorkspaceAction.mockReset().mockResolvedValue({ values: VALUES, version: 2 });
  });

  it('gates a form on form_update for reading as well as saving', () => {
    expect(mockPermissionCalls).toEqual([[Permissions.form_update]]);
  });

  it('refuses a reader without write access before reaching the service', async () => {
    const res = await request(app)
      .get(`/forms/f1/settings/post-submission/${CODE}`)
      .set('x-deny', '1');
    expect(res.status).toBe(403);
    expect(getAction).not.toHaveBeenCalled();
  });

  it('lists the actions for the form in the request', async () => {
    const res = await request(app).get('/forms/f1/settings/post-submission');
    expect(res.status).toBe(200);
    expect(listActions).toHaveBeenCalledWith({ ...CONTEXT, formId: 'f1' });
  });

  it('reads one action of a workspace at its workspace level', async () => {
    const res = await request(app).get(`/workspaces/ws1/settings/post-submission/${CODE}`);
    expect(res.status).toBe(200);
    expect(getAction).toHaveBeenCalledWith(CODE, { ...CONTEXT, formId: null });
  });

  it("saves a form's choice to inherit, naming the version it read", async () => {
    const res = await request(app)
      .put(`/forms/f1/settings/post-submission/${CODE}`)
      .send({ inherit: true, version: 0 });
    expect(res.status).toBe(200);
    expect(setFormAction).toHaveBeenCalledWith(
      CODE,
      { ...CONTEXT, formId: 'f1' },
      {
        inherit: true,
        version: 0,
      },
    );
  });

  it('refuses a body that mixes inherit with values', async () => {
    const res = await request(app)
      .put(`/forms/f1/settings/post-submission/${CODE}`)
      .send({ inherit: true, values: VALUES, version: 1 });
    expect(res.status).toBe(400);
    expect(setFormAction).not.toHaveBeenCalled();
  });

  it('refuses an action code that is not lowercase words joined by dashes', async () => {
    const res = await request(app)
      .put('/workspaces/ws1/settings/post-submission/Bad_Code')
      .send({ values: VALUES, version: 1 });
    expect(res.status).toBe(400);
    expect(setWorkspaceAction).not.toHaveBeenCalled();
  });

  it("saves a workspace's default for an owner or admin", async () => {
    const res = await request(app)
      .put(`/workspaces/ws1/settings/post-submission/${CODE}`)
      .send({ values: VALUES, version: 1 });
    expect(res.status).toBe(200);
    expect(setWorkspaceAction).toHaveBeenCalledWith(
      CODE,
      { ...CONTEXT, formId: null },
      {
        values: VALUES,
        version: 1,
      },
    );
  });
});
