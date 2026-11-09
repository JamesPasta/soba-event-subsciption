jest.mock('../../src/core/middleware/requireFeature', () => ({
  requireFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../src/core/db/repos/submitterSubmissionRepo', () => ({
  findSubmitterSubmission: jest.fn(),
}));
jest.mock('../../src/features/files/service', () => ({
  filesService: { upload: jest.fn(), getForCaller: jest.fn(), deleteForCaller: jest.fn() },
}));
jest.mock('../../src/features/document-generation/service', () => ({
  documentGenerationService: { listTemplates: jest.fn(), print: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import { findSubmitterSubmission } from '../../src/core/db/repos/submitterSubmissionRepo';
import { filesRouter } from '../../src/features/files/route';
import { filesService } from '../../src/features/files/service';
import { documentGenerationRouter } from '../../src/features/document-generation/route';
import { documentGenerationService } from '../../src/features/document-generation/service';
import { coreErrorHandler } from '../../src/core/middleware/errorHandler';
import { storedSubmission } from '../core/api/submit/storedSubmission';

const mockRead = jest.mocked(findSubmitterSubmission);
const files = jest.mocked(filesService);
const documents = jest.mocked(documentGenerationService);

// The routers and controllers are real; the services and the read they call are stubbed.
function buildApp(caller: 'signedIn' | 'anonymous') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (caller === 'signedIn') {
      req.user = { providerCode: 'idir', profile: {} } as unknown as Express.User;
      req.actorId = 'u1';
    } else {
      req.actorId = 'public-user';
      req.idpType = 'public';
    }
    next();
  });
  app.use('/files', filesRouter);
  app.use('/submissions', documentGenerationRouter);
  app.use(coreErrorHandler);
  return app;
}

const submissionId = '01a12d03-75a8-73bc-a106-ce3787ee9a1e';
const signedIn = () => request(buildApp('signedIn'));

beforeEach(() => {
  jest.resetAllMocks();
  files.getForCaller.mockResolvedValue('denied');
  files.deleteForCaller.mockResolvedValue('denied');
  documents.listTemplates.mockResolvedValue({ status: 'denied' });
  documents.print.mockResolvedValue({ status: 'denied' });
});

describe('file and document refusals carry a code', () => {
  it.each([
    ['a file download', 'get', '/files/f1', 'read_denied'],
    ['a file delete', 'delete', '/files/f1', 'write_denied'],
    ['a template list', 'get', `/submissions/${submissionId}/templates`, 'render_denied'],
  ] as const)('refuses %s with %s', async (_label, method, path, code) => {
    const signedInRes = await signedIn()[method](path);
    expect(signedInRes.status).toBe(403);
    expect(signedInRes.body.code).toBe(code);
    const anonymousRes = await request(buildApp('anonymous'))[method](path);
    expect(anonymousRes.status).toBe(401);
    expect(anonymousRes.body.code).toBe(code);
  });

  it('refuses a print with render_denied', async () => {
    const res = await signedIn()
      .post(`/submissions/${submissionId}/print`)
      .send({ templateId: submissionId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('render_denied');
  });
});

describe('file and document failures carry a code', () => {
  it.each([
    ['a missing file on download', 'get', 'notfound', 404, 'file_not_found'],
    ['stored bytes that are gone', 'get', 'unavailable', 503, 'file_unavailable'],
    ['a missing file on delete', 'delete', 'notfound', 404, 'file_not_found'],
  ] as const)('answers %s with %s', async (_label, method, outcome, status, code) => {
    files.getForCaller.mockResolvedValue(outcome as never);
    files.deleteForCaller.mockResolvedValue(outcome as never);
    const res = await signedIn()[method]('/files/f1');
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });

  it('refuses a blocked file type with file_type_blocked', async () => {
    mockRead.mockResolvedValue(storedSubmission());
    const res = await signedIn()
      .post('/files')
      .field('submissionId', 's1')
      .attach('file', Buffer.from('x'), 'tool.exe');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('file_type_blocked');
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('answers a template list for a missing submission with submission_not_found', async () => {
    documents.listTemplates.mockResolvedValue({ status: 'notfound' });
    const res = await signedIn().get(`/submissions/${submissionId}/templates`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('submission_not_found');
  });

  it.each([
    ['notfound', 404, 'submission_not_found'],
    ['template-notfound', 404, 'template_not_found'],
    ['template-unavailable', 503, 'template_unavailable'],
    ['unavailable', 503, 'render_unavailable'],
    ['busy', 503, 'render_busy'],
    ['no-content', 422, 'no_saved_data'],
  ] as const)('answers a print that is %s with %s', async (status, httpStatus, code) => {
    documents.print.mockResolvedValue({ status } as never);
    const res = await signedIn()
      .post(`/submissions/${submissionId}/print`)
      .send({ templateId: submissionId });
    expect(res.status).toBe(httpStatus);
    expect(res.body.code).toBe(code);
  });
});
