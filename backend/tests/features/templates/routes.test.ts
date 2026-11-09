import express from 'express';
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
// Records the resource each request resolves its workspace from.
const mockResolvedFrom: unknown[] = [];
jest.mock('../../../src/core/middleware/workspaceContext', () => ({
  workspaceFromResource:
    (config: unknown) =>
    (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      mockResolvedFrom.push(config);
      req.coreContext = {
        workspaceId: 'ws1',
        formId: 'form1',
        actorId: 'actor1',
      } as unknown as NonNullable<typeof req.coreContext>;
      next();
    },
}));
const mockFeatureAvailable = jest.fn();
jest.mock('../../../src/core/services/featureAvailabilityService', () => ({
  isFeatureAvailable: (...args: unknown[]) => mockFeatureAvailable(...args),
}));
jest.mock('../../../src/features/templates/service', () => ({
  templatesService: {
    list: jest.fn(),
    get: jest.fn(),
    open: jest.fn(),
    create: jest.fn(),
    replaceFile: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
  },
}));

import { Permissions } from '../../../src/core/db/codes';
import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';
import { templatesRouter } from '../../../src/features/templates/route';
import { templatesService } from '../../../src/features/templates/service';

const FORM = '01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c0d';
const VERSION = '01a0dc25-6c98-74fe-a5fb-91bafb93ccbc';
const TEMPLATE = '01a0dc26-a35e-75c4-bff6-4cdaa9b2b274';

const app = express();
app.use(express.json());
app.use('/templates', templatesRouter);
app.use(coreErrorHandler);

const send = (method: string, url: string) => {
  const agent = request(app);
  switch (method) {
    case 'POST':
      return agent
        .post(url)
        .attach('file', Buffer.from('x'), 't.docx')
        .field('type', 'cdogs')
        .field('name', 'Receipt');
    case 'PUT':
      return agent.put(url).attach('file', Buffer.from('x'), 't.docx');
    case 'PATCH':
      return agent.patch(url).send({ name: 'Summary' });
    case 'DELETE':
      return agent.delete(url);
    default:
      return agent.get(url);
  }
};

describe('templates routes', () => {
  beforeEach(() => {
    mockAsked.length = 0;
    mockResolvedFrom.length = 0;
    mockGranted.clear();
    jest.clearAllMocks();
    mockFeatureAvailable.mockResolvedValue(true);
  });

  it("refuses an upload when its type's feature is not available to the form", async () => {
    mockGranted.add(Permissions.document_template_create);
    mockFeatureAvailable.mockResolvedValue(false);
    const res = await send('POST', `/templates?formVersionId=${VERSION}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Template type cdogs is not available for this form' });
    expect(mockFeatureAvailable).toHaveBeenCalledWith('document-generation', {
      workspaceId: 'ws1',
      formId: 'form1',
    });
    expect(templatesService.create).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', `/templates?formId=${FORM}`, 'list'],
    ['GET', `/templates/${TEMPLATE}/content`, 'open'],
    ['PATCH', `/templates/${TEMPLATE}`, 'rename'],
    ['DELETE', `/templates/${TEMPLATE}`, 'remove'],
  ] as const)(
    "lets %s %s through when the type's feature is not available",
    async (method, url, call) => {
      Object.values(Permissions).forEach((p) => mockGranted.add(p));
      mockFeatureAvailable.mockResolvedValue(false);
      const stored = { template: { id: TEMPLATE, type: 'cdogs' }, file: {}, formVersionNo: 1 };
      (templatesService.get as jest.Mock).mockResolvedValue(stored);
      (templatesService[call] as jest.Mock).mockResolvedValue(call === 'list' ? [] : null);
      await send(method, url);
      expect(templatesService[call]).toHaveBeenCalled();
      expect(mockFeatureAvailable).not.toHaveBeenCalled();
    },
  );

  it("refuses a replacement file when its type's feature is not available to the form", async () => {
    mockGranted.add(Permissions.document_template_create);
    mockFeatureAvailable.mockResolvedValue(false);
    (templatesService.get as jest.Mock).mockResolvedValue({
      template: { id: TEMPLATE, type: 'cdogs' },
      file: {},
      formVersionNo: 1,
    });
    const res = await send('PUT', `/templates/${TEMPLATE}/content`);
    expect(res.status).toBe(400);
    expect(templatesService.replaceFile).not.toHaveBeenCalled();
  });

  const READ = [Permissions.form_read, Permissions.document_template_read];

  it.each([
    ['GET', `/templates?formId=${FORM}`, READ],
    ['POST', `/templates?formVersionId=${VERSION}`, [Permissions.document_template_create]],
    ['GET', `/templates/${TEMPLATE}`, READ],
    ['GET', `/templates/${TEMPLATE}/content`, READ],
    ['PUT', `/templates/${TEMPLATE}/content`, [Permissions.document_template_create]],
    ['PATCH', `/templates/${TEMPLATE}`, [Permissions.document_template_create]],
    ['DELETE', `/templates/${TEMPLATE}`, [Permissions.document_template_delete]],
  ])('%s %s requires %j', async (method, url, permissions) => {
    const res = await send(method, url);
    expect(res.status).toBe(403);
    expect(mockAsked).toEqual([permissions]);
  });

  it.each([
    ['GET', `/templates?formId=${FORM}`, { kind: 'form', idFrom: 'queryFormId' }],
    [
      'POST',
      `/templates?formVersionId=${VERSION}`,
      { kind: 'formVersion', idFrom: 'queryFormVersionId' },
    ],
    ['PUT', `/templates/${TEMPLATE}/content`, { kind: 'template', idFrom: 'paramsId' }],
  ])('%s %s resolves its workspace from %j', async (method, url, from) => {
    await send(method, url);
    expect(mockResolvedFrom).toEqual([from]);
  });

  it('refuses a replacement file that its template type does not accept', async () => {
    mockGranted.add(Permissions.document_template_create);
    (templatesService.get as jest.Mock).mockResolvedValue({
      template: { id: TEMPLATE, type: 'cdogs' },
      file: {},
      formVersionNo: 1,
    });
    const res = await request(app)
      .put(`/templates/${TEMPLATE}/content`)
      .attach('file', Buffer.from('x'), 'deck.pptx');
    expect(res.status).toBe(415);
    expect(templatesService.replaceFile).not.toHaveBeenCalled();
  });

  it('refuses an upload before its body is read', async () => {
    const res = await request(app)
      .post(`/templates?formVersionId=${VERSION}`)
      .set('Content-Type', 'multipart/form-data')
      .send('not multipart');
    expect(res.status).toBe(403);
  });

  it('refuses a file that its template type does not accept', async () => {
    mockGranted.add(Permissions.document_template_create);
    const res = await request(app)
      .post(`/templates?formVersionId=${VERSION}`)
      .field('type', 'cdogs')
      .field('name', 'Receipt')
      .attach('file', Buffer.from('x'), 'deck.pptx');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Template must be one of: docx, xlsx, html' });
    expect(templatesService.create).not.toHaveBeenCalled();
  });

  it.each([
    ['no type', {}],
    ['an unknown type', { type: 'print-css' }],
  ])('refuses an upload with %s', async (_what, fields: Record<string, string>) => {
    mockGranted.add(Permissions.document_template_create);
    let req = request(app).post(`/templates?formVersionId=${VERSION}`);
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    const res = await req.attach('file', Buffer.from('x'), 't.docx');
    expect(res.status).toBe(400);
    expect(templatesService.create).not.toHaveBeenCalled();
  });

  it('names an upload without a name after its type', async () => {
    mockGranted.add(Permissions.document_template_create);
    (templatesService.create as jest.Mock).mockResolvedValue(null);
    await request(app)
      .post(`/templates?formVersionId=${VERSION}`)
      .field('type', 'cdogs')
      .field('name', '  ')
      .attach('file', Buffer.from('x'), 't.docx');
    expect(templatesService.create).toHaveBeenCalledWith(
      expect.anything(),
      { id: VERSION, formId: 'form1' },
      { type: 'cdogs', name: 'CDOGS' },
      expect.objectContaining({ filename: 't.docx' }),
    );
  });

  it.each([
    ['a template id', '/templates/engine'],
    ['a form id', '/templates?formId=engine'],
    ['a form version id', `/templates?formVersionId=engine`],
  ])('rejects %s that is not a uuid before any permission check', async (_what, url) => {
    const res = await (url.includes('formVersionId') ? send('POST', url) : request(app).get(url));
    expect(res.status).toBe(400);
    expect(mockAsked).toEqual([]);
  });

  it('refuses a template file name over 255 bytes with 400', async () => {
    Object.values(Permissions).forEach((p) => mockGranted.add(p));
    const res = await request(app)
      .post(`/templates?formVersionId=${VERSION}`)
      .attach('file', Buffer.from('x'), `${'a'.repeat(252)}.docx`)
      .field('type', 'cdogs')
      .field('name', 'Receipt');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'File name is longer than 255 bytes',
      code: 'upload_invalid',
    });
    expect(templatesService.create).not.toHaveBeenCalled();
  });
});
