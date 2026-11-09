import express from 'express';
import request from 'supertest';

// Records the permissions the route asks for and grants only mockGranted.
const mockPermissionCalls: string[][] = [];
const mockGranted = new Set<string>();

jest.mock('../../../src/core/middleware/requireFormPermissions', () => {
  const { ForbiddenError } = jest.requireActual('../../../src/core/errors');
  return {
    requireFormPermissions: (required: readonly string[]) => {
      mockPermissionCalls.push([...required]);
      return (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
        const granted = required.every((p) => mockGranted.has(p));
        next(granted ? undefined : new ForbiddenError('Insufficient form permissions'));
      };
    },
  };
});

jest.mock('../../../src/core/middleware/workspaceContext', () => ({
  workspaceFromResource:
    () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.coreContext = { actorId: 'staff-1', workspaceId: 'ws1' } as unknown as NonNullable<
        typeof req.coreContext
      >;
      next();
    },
}));

const mockFeatureCalls: string[] = [];
const mockFeatureChecked = jest.fn();

jest.mock('../../../src/core/middleware/requireFeature', () => ({
  requireFeature: (feature: string) => {
    mockFeatureCalls.push(feature);
    return (_req: unknown, _res: unknown, next: express.NextFunction) => {
      mockFeatureChecked();
      next();
    };
  },
}));

jest.mock('../../../src/features/files/service', () => ({
  filesService: { getForSubmission: jest.fn() },
}));

jest.mock('../../../src/core/api/shared/sendStoredFile', () => ({
  sendStoredFile: jest.fn(
    async (res: express.Response, _record: unknown, _file: unknown, d: string) => {
      res.status(200).send(d);
    },
  ),
}));

import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';
import { Features, Permissions } from '../../../src/core/db/codes';
import { filesDesignRouter } from '../../../src/features/files/designRoute';
import { filesService } from '../../../src/features/files/service';

const getForSubmission = filesService.getForSubmission as jest.Mock;

const app = express();
app.use(filesDesignRouter);
app.use(coreErrorHandler);

const SUBMISSION_ID = '0199f6a0-0000-7000-8000-000000000001';
const FILE_ID = '0199f6a0-0000-7000-8000-000000000002';
const PATH = `/submissions/${SUBMISSION_ID}/files/${FILE_ID}`;

describe('staff submission file download', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGranted.clear();
    mockGranted.add(Permissions.submission_read);
  });

  it('needs submission_read on the form and the files feature', () => {
    expect(mockPermissionCalls).toEqual([[Permissions.submission_read]]);
    expect(mockFeatureCalls).toEqual([Features.files]);
  });

  it('refuses a staff member without submission_read', async () => {
    mockGranted.clear();

    expect((await request(app).get(PATH)).status).toBe(403);
    expect(mockFeatureChecked).not.toHaveBeenCalled();
    expect(getForSubmission).not.toHaveBeenCalled();
  });

  it('sends the file as an attachment', async () => {
    getForSubmission.mockResolvedValue({ record: {}, file: {} });

    const response = await request(app).get(PATH);

    expect(response.status).toBe(200);
    expect(response.text).toBe('attachment');
    expect(getForSubmission).toHaveBeenCalledWith('ws1', SUBMISSION_ID, FILE_ID);
  });

  it('reads uppercase ids as lowercase', async () => {
    getForSubmission.mockResolvedValue({ record: {}, file: {} });

    const response = await request(app).get(
      `/submissions/${SUBMISSION_ID.toUpperCase()}/files/${FILE_ID.toUpperCase()}`,
    );

    expect(response.status).toBe(200);
    expect(getForSubmission).toHaveBeenCalledWith('ws1', SUBMISSION_ID, FILE_ID);
  });

  it('answers 404 for a file not attached to the submission', async () => {
    getForSubmission.mockResolvedValue('notfound');

    const response = await request(app).get(PATH);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('file_not_found');
  });

  it('answers 503 when the stored bytes are gone', async () => {
    getForSubmission.mockResolvedValue('unavailable');

    const response = await request(app).get(PATH);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('file_unavailable');
  });

  it('refuses ids that are not uuids', async () => {
    expect((await request(app).get('/submissions/x/files/y')).status).toBe(400);
  });
});
