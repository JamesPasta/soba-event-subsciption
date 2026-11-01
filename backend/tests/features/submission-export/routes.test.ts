import { Readable } from 'node:stream';
import express from 'express';
import request from 'supertest';

// The real middleware resolves the form's workspace, the caller's access and the feature's status
// from the database, which these tests are not about. The stand-ins record what each route asks
// for, resolve a fixed workspace, refuse a request carrying x-deny, and turn the feature off for a
// request carrying x-feature-off.
const mockPermissionCalls: string[][] = [];
const mockFeatureCalls: string[] = [];

jest.mock('../../../src/core/middleware/workspaceContext', () => ({
  workspaceFromResource:
    () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.coreContext = {
        actorId: req.get('x-actor') ?? 'starter',
        workspaceId: 'ws1',
      } as unknown as NonNullable<typeof req.coreContext>;
      next();
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

jest.mock('../../../src/core/middleware/requireFeature', () => {
  const { NotFoundError } = jest.requireActual('../../../src/core/errors');
  return {
    requireFeature: (code: string) => {
      mockFeatureCalls.push(code);
      return (req: express.Request, _res: express.Response, next: express.NextFunction) =>
        next(req.get('x-feature-off') ? new NotFoundError('Not found') : undefined);
    },
  };
});

jest.mock('../../../src/features/submission-export/service', () => ({
  submissionExportService: {
    fields: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    start: jest.fn(),
    cancel: jest.fn(),
    openDownload: jest.fn(),
  },
}));

import { ApiErrorCodes } from '@soba/lib';
import { Features, Permissions } from '../../../src/core/db/codes';
import { ConflictError, NotFoundError, TooManyRequestsError } from '../../../src/core/errors';
import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';
import { submissionExportRouter } from '../../../src/features/submission-export/route';
import { submissionExportService } from '../../../src/features/submission-export/service';

const service = jest.mocked(submissionExportService);

const FORM_ID = '0199f6a0-0000-7000-8000-000000000001';
const EXPORT_ID = '0199f6a0-0000-7000-8000-0000000000aa';
const EXPORTS = `/forms/${FORM_ID}/exports`;
const CONTEXT = { actorId: 'starter', workspaceId: 'ws1', formId: FORM_ID };
const QUEUED = { id: EXPORT_ID, formId: FORM_ID, format: 'csv', status: 'queued' };

const app = express();
app.use(express.json());
app.use(submissionExportRouter);
app.use(coreErrorHandler);

const ROUTES: [string, () => request.Test][] = [
  ['the field list', () => request(app).post(`${EXPORTS}/fields`).send({})],
  ['a start', () => request(app).post(EXPORTS).send({})],
  ['the list', () => request(app).get(EXPORTS)],
  ['one export', () => request(app).get(`${EXPORTS}/${EXPORT_ID}`)],
  ['a download', () => request(app).get(`${EXPORTS}/${EXPORT_ID}/file`)],
  ['a stop', () => request(app).post(`${EXPORTS}/${EXPORT_ID}/cancel`)],
];

describe('submission export routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('gate every route on submission_read and the submission-export feature', () => {
    expect(new Set(mockPermissionCalls.map((codes) => codes.join()))).toEqual(
      new Set([Permissions.submission_read]),
    );
    expect(new Set(mockFeatureCalls)).toEqual(new Set([Features.submission_export]));
  });

  it.each(ROUTES)(
    'refuses %s without access, before saying whether exports are on',
    async (_label, send) => {
      const response = await send().set('x-deny', '1').set('x-feature-off', '1');

      expect(response.status).toBe(403);
      expect(Object.values(service).some((fn) => fn.mock.calls.length > 0)).toBe(false);
    },
  );

  it.each(ROUTES)('answers %s with 404 while exports are off', async (_label, send) => {
    const response = await send().set('x-feature-off', '1');

    expect(response.status).toBe(404);
    expect(Object.values(service).some((fn) => fn.mock.calls.length > 0)).toBe(false);
  });

  it('answers the field list and the count for the caller on the form, with its filters', async () => {
    const answer = { fields: ['form.confirmationId', 'name'], count: 3 };
    service.fields.mockResolvedValue(answer);
    const body = { formVersionId: EXPORT_ID, from: '2026-10-01T07:00:00.000Z' };

    const response = await request(app).post(`${EXPORTS}/fields`).send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(answer);
    expect(service.fields).toHaveBeenCalledWith(CONTEXT, body);
  });

  it('starts an export for the caller on the form, with the filters it was given', async () => {
    service.start.mockResolvedValue(QUEUED as never);

    const response = await request(app)
      .post(EXPORTS)
      .send({ from: '2026-10-01T07:00:00.000Z', layout: 'singleRowCSVExport', fields: ['a'] });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(QUEUED);
    expect(service.start).toHaveBeenCalledWith(CONTEXT, {
      format: 'csv',
      from: '2026-10-01T07:00:00.000Z',
      layout: 'singleRowCSVExport',
      fields: ['a'],
    });
  });

  it('answers 429 with its code when the caller has as many exports running as allowed', async () => {
    service.start.mockRejectedValue(
      new TooManyRequestsError('Too many', ApiErrorCodes.export_limit_reached),
    );

    const response = await request(app).post(EXPORTS).send({});

    expect(response.status).toBe(429);
    expect(response.body.code).toBe(ApiErrorCodes.export_limit_reached);
  });

  it("lists one page of the caller's exports, passing only the paging and sort it names", async () => {
    const page = {
      items: [QUEUED],
      page: { offset: 10, limit: 5, total: 11 },
      sort: 'createdAt:asc',
    };
    service.list.mockResolvedValue(page as never);

    const response = await request(app).get(
      `${EXPORTS}?offset=10&limit=5&sort=createdAt:asc&formId=someone-elses`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(page);
    expect(service.list).toHaveBeenCalledWith(CONTEXT, {
      offset: 10,
      limit: 5,
      sort: 'createdAt:asc',
    });
  });

  it('lists newest first by default, and refuses a sort it does not offer or a cursor', async () => {
    service.list.mockResolvedValue({
      items: [],
      page: { offset: 0, limit: 10, total: 0 },
    } as never);

    await request(app).get(EXPORTS);
    expect(service.list).toHaveBeenCalledWith(
      CONTEXT,
      expect.objectContaining({ offset: 0, sort: 'createdAt:desc' }),
    );
    expect((await request(app).get(`${EXPORTS}?sort=status:asc`)).status).toBe(400);
    expect((await request(app).get(`${EXPORTS}?cursor=abc`)).status).toBe(400);
  });

  it('reads one export as the caller, and 404 when it is not theirs', async () => {
    service.get.mockResolvedValueOnce(QUEUED as never);
    service.get.mockRejectedValueOnce(new NotFoundError('Export not found'));

    const mine = await request(app).get(`${EXPORTS}/${EXPORT_ID}`);
    const theirs = await request(app).get(`${EXPORTS}/${EXPORT_ID}`).set('x-actor', 'someone');

    expect(mine.status).toBe(200);
    expect(service.get).toHaveBeenNthCalledWith(1, CONTEXT, EXPORT_ID);
    expect(theirs.status).toBe(404);
    expect(service.get).toHaveBeenNthCalledWith(2, { ...CONTEXT, actorId: 'someone' }, EXPORT_ID);
  });

  it('answers a stop with 200 once cancelled, 202 while it stops, and 409 once finished', async () => {
    service.cancel.mockResolvedValueOnce({ stopped: true, export: QUEUED } as never);
    service.cancel.mockResolvedValueOnce({ stopped: false, export: QUEUED } as never);
    service.cancel.mockRejectedValueOnce(new ConflictError('The export has finished'));
    const stop = () => request(app).post(`${EXPORTS}/${EXPORT_ID}/cancel`);

    expect((await stop()).status).toBe(200);
    expect((await stop()).status).toBe(202);
    expect((await stop()).status).toBe(409);
  });

  it('streams a ready file as an attachment with its name', async () => {
    service.openDownload.mockResolvedValue({
      state: 'ready',
      file: { id: 'file-1', filename: 'Permit 2026-10-29.csv', contentType: 'text/csv', size: 10 },
      content: { downloadStream: Readable.from(['a,b\r\n1,2\r\n']), size: 10 },
    } as never);

    const response = await request(app).get(`${EXPORTS}/${EXPORT_ID}/file`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('Permit');
    expect(response.text).toBe('a,b\r\n1,2\r\n');
  });

  it('answers 404 for a file that is not ready', async () => {
    service.openDownload.mockRejectedValue(
      new NotFoundError('Export file not available', ApiErrorCodes.file_not_found),
    );

    const response = await request(app).get(`${EXPORTS}/${EXPORT_ID}/file`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ApiErrorCodes.file_not_found);
  });

  it.each([
    [
      'a range that ends before it starts',
      { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' },
    ],
    ['a date without a time', { from: '2026-10-01' }],
    ['an unknown layout', { layout: 'fancy' }],
    ['an unknown format', { format: 'xlsx' }],
  ])('refuses %s', async (_label, body) => {
    const response = await request(app).post(EXPORTS).send(body);

    expect(response.status).toBe(400);
    expect(service.start).not.toHaveBeenCalled();
  });

  it('refuses ids that are not uuids', async () => {
    expect((await request(app).get('/forms/not-a-uuid/exports')).status).toBe(400);
    expect((await request(app).get(`${EXPORTS}/not-a-uuid/file`)).status).toBe(400);
  });
});
