import express from 'express';
import request from 'supertest';

jest.mock('../../../src/core/middleware/requireFeature', () => ({
  requireFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../../src/core/middleware/rateLimit', () => ({
  renderRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../../src/core/middleware/actor', () => ({
  resolveCaller: () => ({ actorId: 'actor1', idpCode: 'idir' }),
}));
// accessDenial needs only the request; its module's repo imports would reach for the database.
jest.mock('../../../src/core/middleware/formSubmitAccess', () => {
  const { ForbiddenError, UnauthorizedError } = jest.requireActual('../../../src/core/errors');
  return {
    accessDenial: (req: express.Request, message: string) =>
      req.user ? new ForbiddenError(message) : new UnauthorizedError(message),
  };
});
jest.mock('../../../src/features/document-generation/service', () => ({
  documentGenerationService: { listTemplates: jest.fn(), print: jest.fn() },
  staffDocumentService: {},
}));

import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';
import { documentGenerationRouter } from '../../../src/features/document-generation/route';
import { documentGenerationService } from '../../../src/features/document-generation/service';

const SUBMISSION = '01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c0d';
const TEMPLATE = '01a0dc26-a35e-75c4-bff6-4cdaa9b2b274';
const listTemplates = documentGenerationService.listTemplates as jest.Mock;
const print = documentGenerationService.print as jest.Mock;

const app = express();
app.use(express.json());
app.use('/submissions', documentGenerationRouter);
app.use(coreErrorHandler);

const ok = {
  status: 'ok',
  code: 'cdogs-v2',
  data: Buffer.from('doc'),
  contentType: 'application/pdf',
};

const postPrint = (body: object) =>
  request(app).post(`/submissions/${SUBMISSION}/print`).send(body);

beforeEach(() => {
  jest.clearAllMocks();
  print.mockResolvedValue(ok);
});

describe('GET /:id/templates', () => {
  it('returns the print facts', async () => {
    const facts = { items: [{ id: TEMPLATE }], renderAvailable: true };
    listTemplates.mockResolvedValue({ status: 'ok', facts });
    const res = await request(app).get(`/submissions/${SUBMISSION}/templates`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(facts);
  });

  it('refuses a caller the submitter rules deny', async () => {
    listTemplates.mockResolvedValue({ status: 'denied' });
    const res = await request(app).get(`/submissions/${SUBMISSION}/templates`);
    expect(res.status).toBe(401);
  });
});

describe('POST /:id/print', () => {
  it('streams the document named from the options', async () => {
    const options = { convertTo: 'pdf', reportName: 'Receipt' };
    const res = await postPrint({ templateId: TEMPLATE, options });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Receipt.pdf');
    expect(print).toHaveBeenCalledWith(expect.anything(), {
      submissionId: SUBMISSION,
      templateId: TEMPLATE,
      options,
    });
  });

  it.each([
    ['an option the print does not take', { overwrite: false }],
    ['a format other than pdf', { convertTo: 'docx' }],
    ['an empty report name', { reportName: ' ' }],
  ])('refuses %s with 400', async (_label, options) => {
    const res = await postPrint({ templateId: TEMPLATE, options });
    expect(res.status).toBe(400);
    expect(print).not.toHaveBeenCalled();
  });

  it('refuses a body field the print does not take with 400', async () => {
    const res = await postPrint({ templateId: TEMPLATE, data: { field: 'x' } });
    expect(res.status).toBe(400);
    expect(print).not.toHaveBeenCalled();
  });

  it('answers 422 no_saved_data when the submission has no saved answers', async () => {
    print.mockResolvedValue({ status: 'no-content' });
    const res = await postPrint({ templateId: TEMPLATE });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('no_saved_data');
  });
});

describe('POST /:id/print/upload', () => {
  it('is not a submit route', async () => {
    const res = await request(app)
      .post(`/submissions/${SUBMISSION}/print/upload`)
      .attach('file', Buffer.from('template'), 't.docx');
    expect(res.status).toBe(404);
  });
});
