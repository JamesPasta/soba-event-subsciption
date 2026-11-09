import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';

// Records the permissions each request asks for and grants only mockGranted. The real middleware
// resolves permissions from the database, which these tests are not about.
const mockAsked: string[][] = [];
const mockGranted = new Set<string>();

jest.mock('../../../src/core/middleware/requireFormPermissions', () => {
  const { ForbiddenError } = jest.requireActual('../../../src/core/errors');
  return {
    requireFormPermissions:
      (required: readonly string[]) =>
      (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
        mockAsked.push([...required]);
        const granted = required.every((p) => mockGranted.has(p));
        next(granted ? undefined : new ForbiddenError('Insufficient form permissions'));
      },
  };
});
jest.mock('../../../src/core/middleware/requireFeature', () => ({
  requireFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../../src/core/middleware/rateLimit', () => ({
  renderRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../../src/core/middleware/workspaceContext', () => ({
  workspaceFromResource:
    () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.coreContext = {
        workspaceId: 'ws1',
        formId: 'form1',
        actorId: 'actor1',
      } as unknown as NonNullable<typeof req.coreContext>;
      next();
    },
}));
jest.mock('../../../src/features/document-generation/service', () => ({
  documentGenerationService: {},
  staffDocumentService: {
    listTemplates: jest.fn(),
    print: jest.fn(),
    prepareUpload: jest.fn(),
    printUpload: jest.fn(),
  },
}));

import rTracer from 'cls-rtracer';
import { env } from '../../../src/core/config/env';
import { httpLogger } from '../../../src/core/logging';
import { Permissions } from '../../../src/core/db/codes';
import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';
import { documentGenerationDesignRouter } from '../../../src/features/document-generation/designRoute';
import { takeRenderSlot } from '../../../src/features/document-generation/renderSlots';
import { staffDocumentService } from '../../../src/features/document-generation/service';

const SUBMISSION = '01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c0d';
const TEMPLATE = '01a0dc26-a35e-75c4-bff6-4cdaa9b2b274';
const service = jest.mocked(staffDocumentService);
const MAX_RENDERS = env.getDocumentGenerationMaxConcurrent();
const MAX_TEMPLATE_BYTES = env.getTemplatesMaxFileSizeMb() * 1024 * 1024;

// The tracer and request logger app.ts mounts: the tracer's removeListener drops the last listener
// added for an event, whichever one the logger asked to remove.
const app = express();
app.use(rTracer.expressMiddleware());
app.use(httpLogger);
app.use(express.json());
app.use(documentGenerationDesignRouter);
app.use(coreErrorHandler);

const prepared = {
  scope: { workspaceId: 'ws1', formId: 'form1', formVersionId: 'fv1' },
  submissionId: SUBMISSION,
  backendCode: 'cdogs-v2',
};
const ok = {
  status: 'ok',
  code: 'cdogs-v2',
  data: Buffer.from('doc'),
  contentType: 'application/pdf',
} as const;

const UPLOAD_PATH = `/print-upload/${SUBMISSION}`;
const postUpload = (content = Buffer.from('template'), filename = 't.docx') =>
  request(app).post(UPLOAD_PATH).attach('file', content, filename);

/** Every render slot this process has, until `release` is called. */
const takeEverySlot = () => {
  const releases = Array.from({ length: MAX_RENDERS }, () => takeRenderSlot(MAX_RENDERS));
  return () => releases.forEach((release) => release?.());
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAsked.length = 0;
  mockGranted.clear();
  mockGranted.add(Permissions.submission_read);
  mockGranted.add(Permissions.submission_print_upload);
  service.prepareUpload.mockResolvedValue({ status: 'ok', prepared });
  service.printUpload.mockResolvedValue(ok);
  service.print.mockResolvedValue(ok);
});

describe('GET /:id/templates', () => {
  it('needs submission_read and returns the print facts', async () => {
    const facts = {
      items: [{ id: TEMPLATE, name: 'R', filename: 'r.docx', createdAt: '2026-01-02T03:04:05Z' }],
      renderAvailable: true,
    };
    service.listTemplates.mockResolvedValue({ status: 'ok', facts });
    const res = await request(app).get(`/submissions/${SUBMISSION}/templates`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(facts);
    expect(mockAsked).toEqual([[Permissions.submission_read]]);
    expect(service.listTemplates).toHaveBeenCalledWith('ws1', SUBMISSION);
  });
});

describe('POST /:id/print', () => {
  it('needs submission_read and prints with the stored template', async () => {
    const res = await request(app)
      .post(`/submissions/${SUBMISSION}/print`)
      .send({ templateId: TEMPLATE, options: { convertTo: 'pdf' } });
    expect(res.status).toBe(200);
    expect(mockAsked).toEqual([[Permissions.submission_read]]);
    expect(service.print).toHaveBeenCalledWith('ws1', 'actor1', {
      submissionId: SUBMISSION,
      templateId: TEMPLATE,
      options: { convertTo: 'pdf' },
    });
  });

  it('refuses a staff member without submission_read', async () => {
    mockGranted.clear();
    const res = await request(app)
      .post(`/submissions/${SUBMISSION}/print`)
      .send({ templateId: TEMPLATE });
    expect(res.status).toBe(403);
    expect(service.print).not.toHaveBeenCalled();
  });
});

describe('POST /print-upload/:id', () => {
  it('renders the uploaded template with the options from the form fields', async () => {
    const res = await postUpload().field('convertTo', 'pdf').field('reportName', 'Receipt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Receipt.pdf');
    expect(mockAsked).toEqual([[Permissions.submission_read, Permissions.submission_print_upload]]);
    expect(service.prepareUpload).toHaveBeenCalledWith('ws1', SUBMISSION);
    expect(service.printUpload).toHaveBeenCalledWith(
      prepared,
      { content: Buffer.from('template'), fileType: 'docx', filename: 't.docx' },
      { convertTo: 'pdf', reportName: 'Receipt' },
      'actor1',
    );
  });

  it('refuses a caller without the upload permission before reading an oversize body', async () => {
    mockGranted.delete(Permissions.submission_print_upload);
    const res = await postUpload(Buffer.alloc(MAX_TEMPLATE_BYTES + 1));
    expect(res.status).toBe(403);
    expect(service.prepareUpload).not.toHaveBeenCalled();
  });

  it('answers 413 for an oversize template from a permitted caller', async () => {
    const res = await postUpload(Buffer.alloc(MAX_TEMPLATE_BYTES + 1));
    expect(res.status).toBe(413);
    expect(service.printUpload).not.toHaveBeenCalled();
  });

  it('is busy before reading the body when every render slot is taken', async () => {
    const release = takeEverySlot();
    try {
      const res = await postUpload();
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('render_busy');
      expect(service.prepareUpload).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it('frees its render slot once the print ends, refused or not', async () => {
    await postUpload().expect(200);
    await postUpload(Buffer.alloc(MAX_TEMPLATE_BYTES + 1)).expect(413);
    await postUpload().field('data', '{}').expect(400);
    service.printUpload.mockResolvedValueOnce({ status: 'infected' });
    await postUpload().expect(422);
    service.prepareUpload.mockResolvedValue({ status: 'no-content' });
    await postUpload().expect(422);
    const slots = Array.from({ length: MAX_RENDERS }, () => takeRenderSlot(MAX_RENDERS));
    slots.forEach((release) => release?.());
    expect(slots.every((release) => release !== null)).toBe(true);
  });

  it.each([
    ['notfound', 404, 'submission_not_found'],
    ['no-content', 422, 'no_saved_data'],
    ['unavailable', 503, 'render_unavailable'],
  ] as const)('refuses a %s preflight with %s %s', async (status, httpStatus, code) => {
    service.prepareUpload.mockResolvedValue({ status });
    const res = await postUpload();
    expect(res.status).toBe(httpStatus);
    expect(res.body.code).toBe(code);
    expect(service.printUpload).not.toHaveBeenCalled();
  });

  it('refuses a form field the print does not take with 400', async () => {
    const res = await postUpload().field('data', '{}');
    expect(res.status).toBe(400);
    expect(service.printUpload).not.toHaveBeenCalled();
  });

  it('refuses a file type a CDOGS template does not accept with 415', async () => {
    const res = await postUpload(Buffer.from('template'), 't.pdf');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('file_type_blocked');
    expect(service.printUpload).not.toHaveBeenCalled();
  });

  it('frees its render slot when the client leaves during the preflight', async () => {
    let preflightDone: () => void = () => undefined;
    const preflightRan = new Promise<void>((resolve) => (preflightDone = resolve));
    service.prepareUpload.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      preflightDone();
      return { status: 'ok', prepared };
    });
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const client = http.request({
        port,
        method: 'POST',
        path: UPLOAD_PATH,
        headers: { 'content-type': 'multipart/form-data; boundary=b', 'content-length': '100000' },
      });
      client.on('error', () => undefined);
      client.write('--b\r\n');
      setTimeout(() => client.destroy(), 50);
      await preflightRan;
      await new Promise((resolve) => setTimeout(resolve, 200));

      const slots = Array.from({ length: MAX_RENDERS }, () => takeRenderSlot(MAX_RENDERS));
      slots.forEach((release) => release?.());
      expect(slots.every((release) => release !== null)).toBe(true);
      expect(service.printUpload).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it.each([
    ['infected', 422, 'file_infected'],
    ['scan-unavailable', 503, 'scan_unavailable'],
  ] as const)('answers a %s scan with %s %s', async (status, httpStatus, code) => {
    service.printUpload.mockResolvedValue({ status });
    const res = await postUpload();
    expect(res.status).toBe(httpStatus);
    expect(res.body.code).toBe(code);
  });
});
