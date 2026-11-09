import express from 'express';
import request from 'supertest';

// The real middleware resolves the form or workspace and the caller's access from the database,
// which these tests are not about. The stand-ins record what each route asks for, resolve to a
// fixed form and workspace, and refuse a request that carries x-deny.
const mockPermissionCalls: string[][] = [];
const mockResourceKinds: string[] = [];

jest.mock('../../../src/core/middleware/workspaceContext', () => ({
  workspaceFromResource: (config: { kind: string }) => {
    mockResourceKinds.push(config.kind);
    return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.coreContext = {
        actorId: 'a1',
        workspaceId: 'resolved-workspace',
        ...(config.kind === 'form' ? { formId: 'resolved-form' } : {}),
      } as unknown as NonNullable<typeof req.coreContext>;
      next();
    };
  },
}));

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
    requireWorkspaceOwner: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) =>
      next(req.get('x-deny') ? new ForbiddenError('Requires the workspace owner role') : undefined),
  };
});

jest.mock('../../../src/core/db/repos/jobViewRepo', () => ({
  listJobs: jest.fn(),
  listJobForms: jest.fn(),
}));

jest.mock('../../../src/core/services/jobViewService', () => ({
  getStaffJobDetail: jest.fn(),
  rerunJob: jest.fn(),
  stopJob: jest.fn(),
  toStaffJobListItem: (row: unknown) => row,
}));

import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';
import { Permissions } from '../../../src/core/db/codes';
import { listJobForms, listJobs } from '../../../src/core/db/repos/jobViewRepo';
import { getStaffJobDetail, rerunJob, stopJob } from '../../../src/core/services/jobViewService';
import { formJobsRouter, workspaceJobsRouter } from '../../../src/features/jobs/route';

const listJobsMock = jest.mocked(listJobs);
const listJobFormsMock = jest.mocked(listJobForms);
const getStaffJobDetailMock = jest.mocked(getStaffJobDetail);
const rerunJobMock = jest.mocked(rerunJob);
const stopJobMock = jest.mocked(stopJob);

const JOB_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_FORM = '00000000-0000-4000-8000-000000000002';
const FORM_SCOPE = { kind: 'form', formId: 'resolved-form' };
const WORKSPACE_SCOPE = { kind: 'workspace', workspaceId: 'resolved-workspace' };
const DETAIL = { id: JOB_ID, status: 'queued' };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.actorId = 'a1';
  next();
});
app.use('/forms/:id/jobs', formJobsRouter);
app.use('/workspaces/:id/jobs', workspaceJobsRouter);
app.use(coreErrorHandler);

describe('jobs routes', () => {
  beforeEach(() => {
    listJobsMock.mockReset().mockResolvedValue({ items: [], total: 0 });
    listJobFormsMock.mockReset().mockResolvedValue([]);
    getStaffJobDetailMock.mockReset().mockResolvedValue(DETAIL as never);
    rerunJobMock.mockReset().mockResolvedValue();
    stopJobMock.mockReset().mockResolvedValue({ stopped: true });
  });

  it('resolves a form for the form routes and a workspace for the workspace routes', () => {
    expect(mockResourceKinds).toEqual(['form', 'workspace']);
    expect(mockPermissionCalls).toEqual([[Permissions.form_update]]);
  });

  it.each([
    ['get', '/forms/f1/jobs'],
    ['get', `/forms/f1/jobs/${JOB_ID}`],
    ['post', `/forms/f1/jobs/${JOB_ID}/rerun`],
    ['post', `/forms/f1/jobs/${JOB_ID}/cancel`],
    ['get', '/workspaces/w1/jobs'],
    ['get', '/workspaces/w1/jobs/forms'],
    ['get', `/workspaces/w1/jobs/${JOB_ID}`],
    ['post', `/workspaces/w1/jobs/${JOB_ID}/rerun`],
    ['post', `/workspaces/w1/jobs/${JOB_ID}/cancel`],
  ] as const)('refuses %s %s before reading any job', async (method, path) => {
    const res = await request(app)[method](path).set('x-deny', '1');
    expect(res.status).toBe(403);
    expect(listJobsMock).not.toHaveBeenCalled();
    expect(listJobFormsMock).not.toHaveBeenCalled();
    expect(getStaffJobDetailMock).not.toHaveBeenCalled();
    expect(rerunJobMock).not.toHaveBeenCalled();
    expect(stopJobMock).not.toHaveBeenCalled();
  });

  it('lists the resolved form, ignoring a form in the query', async () => {
    const res = await request(app).get(`/forms/f1/jobs?status=dead&formId=${OTHER_FORM}`);
    expect(res.status).toBe(200);
    expect(listJobsMock).toHaveBeenCalledWith(FORM_SCOPE, {
      status: 'dead',
      type: undefined,
      formId: undefined,
      offset: 0,
      limit: 20,
      sort: 'createdAt:desc',
    });
    expect(res.body.filters).toEqual({ status: 'dead' });
  });

  it('lists the resolved workspace, narrowed to a form', async () => {
    const res = await request(app).get(`/workspaces/w1/jobs?formId=${OTHER_FORM}`);
    expect(res.status).toBe(200);
    expect(listJobsMock).toHaveBeenCalledWith(
      WORKSPACE_SCOPE,
      expect.objectContaining({ formId: OTHER_FORM }),
    );
  });

  it('lists the forms that have jobs in the workspace', async () => {
    listJobFormsMock.mockResolvedValue([{ id: OTHER_FORM, name: 'Permit' }]);
    const res = await request(app).get('/workspaces/w1/jobs/forms');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: OTHER_FORM, name: 'Permit' }] });
    expect(listJobFormsMock).toHaveBeenCalledWith(WORKSPACE_SCOPE);
  });

  it('reads one job in the resolved scope', async () => {
    const res = await request(app).get(`/forms/f1/jobs/${JOB_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DETAIL);
    expect(getStaffJobDetailMock).toHaveBeenCalledWith(FORM_SCOPE, JOB_ID);
  });

  it('runs a job again in the resolved scope as the caller, and returns the staff detail', async () => {
    const res = await request(app).post(`/workspaces/w1/jobs/${JOB_ID}/rerun`);
    expect(res.status).toBe(200);
    expect(rerunJobMock).toHaveBeenCalledWith(WORKSPACE_SCOPE, JOB_ID, 'a1');
    expect(getStaffJobDetailMock).toHaveBeenCalledWith(WORKSPACE_SCOPE, JOB_ID);
  });

  it('answers 200 for a job stopped now and 202 for one asked to stop', async () => {
    const stopped = await request(app).post(`/forms/f1/jobs/${JOB_ID}/cancel`);
    expect(stopped.status).toBe(200);
    expect(stopJobMock).toHaveBeenCalledWith(FORM_SCOPE, JOB_ID, 'a1');

    stopJobMock.mockResolvedValue({ stopped: false });
    const requested = await request(app).post(`/forms/f1/jobs/${JOB_ID}/cancel`);
    expect(requested.status).toBe(202);
    expect(requested.body).toEqual(DETAIL);
  });

  it.each([
    ['get', '/forms/f1/jobs/not-a-uuid'],
    ['post', '/forms/f1/jobs/not-a-uuid/rerun'],
    ['get', '/forms/f1/jobs/forms'],
    ['get', '/forms/f1/jobs?status=failed'],
    ['get', '/workspaces/w1/jobs?formId=f1'],
    ['get', '/workspaces/w1/jobs?sort=type:asc'],
  ] as const)('refuses %s %s as invalid', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(400);
  });
});
