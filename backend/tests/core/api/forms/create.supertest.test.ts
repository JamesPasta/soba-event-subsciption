import express from 'express';
import request from 'supertest';

// Records what each route asks for, and refuses a request that carries x-deny. The real middleware
// resolves workspaces and permissions from the database, which these tests are not about.
const mockPermissionCalls: string[][] = [];

jest.mock('../../../../src/core/middleware/requireFormPermissions', () => {
  const { ForbiddenError } = jest.requireActual('../../../../src/core/errors');
  return {
    requireFormPermissions: (required: readonly string[]) => {
      mockPermissionCalls.push([...required]);
      return (req: express.Request, _res: express.Response, next: express.NextFunction) =>
        next(req.get('x-deny') ? new ForbiddenError('Insufficient form permissions') : undefined);
    },
  };
});

jest.mock('../../../../src/core/middleware/workspaceContext', () => {
  const setContext = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.coreContext = { workspaceId: 'ws1' } as NonNullable<typeof req.coreContext>;
    next();
  };
  return {
    workspaceFromBody: setContext,
    workspaceListScope: () => setContext,
    workspaceFromResource: () => setContext,
  };
});

jest.mock('../../../../src/core/container', () => ({
  formsApiService: { createForm: jest.fn(), createDraft: jest.fn() },
}));

import { designFormsRouter } from '../../../../src/core/api/forms/route';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';
import { formsApiService } from '../../../../src/core/container';
import { Permissions } from '../../../../src/core/db/codes';

const createFormMock = formsApiService.createForm as jest.Mock;
const createDraftMock = formsApiService.createDraft as jest.Mock;

const FORM_ID = '01a11400-0000-7000-8000-000000000001';
const VERSION_ID = '01a11400-0000-7000-8000-000000000002';

const app = express();
app.use(express.json());
app.use(designFormsRouter);
app.use(coreErrorHandler);

beforeEach(() => {
  createFormMock.mockReset();
  createDraftMock.mockReset();
});

describe('POST /forms', () => {
  const body = { workspaceId: 'ws1', name: 'My Form', id: FORM_ID, versionId: VERSION_ID };

  it.each([
    [true, 201],
    [false, 200],
  ])('answers created=%s with %s', async (created, status) => {
    createFormMock.mockResolvedValue({ created, form: { id: FORM_ID } });

    const res = await request(app).post('/forms').send(body);

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ id: FORM_ID });
    expect(createFormMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1' }),
      expect.objectContaining({ id: FORM_ID, versionId: VERSION_ID }),
    );
  });

  // A retry is matched on both ids, so one without the other cannot be replayed.
  it('refuses a form id without a version id', async () => {
    const res = await request(app)
      .post('/forms')
      .send({ ...body, versionId: undefined });
    expect(res.status).toBe(400);
    expect(createFormMock).not.toHaveBeenCalled();
  });
});

describe('POST /form-versions', () => {
  const body = { id: VERSION_ID, formId: 'f1', schema: { components: [] } };

  // Creating a draft writes its schema, so it needs the permission saving one does.
  it('needs design_create and design_update', async () => {
    expect(mockPermissionCalls).toContainEqual([
      Permissions.design_create,
      Permissions.design_update,
    ]);
    const res = await request(app).post('/form-versions').set('x-deny', '1').send(body);
    expect(res.status).toBe(403);
    expect(createDraftMock).not.toHaveBeenCalled();
  });

  it.each([
    [true, 201],
    [false, 200],
  ])('answers created=%s with %s', async (created, status) => {
    createDraftMock.mockResolvedValue({ created, version: { id: VERSION_ID } });

    const res = await request(app).post('/form-versions').send(body);

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ id: VERSION_ID });
    expect(createDraftMock).toHaveBeenCalledWith(expect.anything(), body);
  });

  // Postgres returns uuids lowercase, and a retry is matched against the stored ids.
  it('lowercases the ids', async () => {
    createDraftMock.mockResolvedValue({ created: true, version: { id: VERSION_ID } });
    const formId = '01a11400-0000-7000-8000-00000000000f';

    await request(app)
      .post('/form-versions')
      .send({ ...body, id: VERSION_ID.toUpperCase(), formId: formId.toUpperCase() });

    expect(createDraftMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: VERSION_ID, formId }),
    );
  });

  it('refuses an id that is not a UUIDv7', async () => {
    const res = await request(app)
      .post('/form-versions')
      .send({ ...body, id: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(createDraftMock).not.toHaveBeenCalled();
  });
});
