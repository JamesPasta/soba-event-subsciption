jest.mock('../../../../src/core/container', () => ({
  submissionsApiService: {
    readContent: jest.fn(),
    open: jest.fn(),
    save: jest.fn(),
    submit: jest.fn(),
    deleteUnsubmitted: jest.fn(),
  },
  formVersionService: { readSchema: jest.fn(), schemaHash: jest.fn() },
  formsApiService: {},
}));
jest.mock('../../../../src/core/db/repos/submitterSubmissionRepo', () => ({
  findSubmitterSubmission: jest.fn(),
}));
jest.mock('../../../../src/core/db/repos/submitterFormRepo', () => ({
  ...jest.requireActual('../../../../src/core/db/repos/submitterFormRepo'),
  findLiveSubmitterForm: jest.fn(),
  findSubmitterFormVersion: jest.fn(),
}));
jest.mock('../../../../src/core/db/repos/submissionRepo', () => ({
  ...jest.requireActual('../../../../src/core/db/repos/submissionRepo'),
  getSubmissionRevisionById: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import { submitRouter } from '../../../../src/core/api/submit';
import { formVersionService, submissionsApiService } from '../../../../src/core/container';
import { findSubmitterSubmission } from '../../../../src/core/db/repos/submitterSubmissionRepo';
import {
  findLiveSubmitterForm,
  findSubmitterFormVersion,
} from '../../../../src/core/db/repos/submitterFormRepo';
import { getSubmissionRevisionById } from '../../../../src/core/db/repos/submissionRepo';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';
import { storedSubmission } from './storedSubmission';

const mockRead = jest.mocked(findSubmitterSubmission);
const mockForm = jest.mocked(findLiveSubmitterForm);
const mockVersion = jest.mocked(findSubmitterFormVersion);
const mockRevision = jest.mocked(getSubmissionRevisionById);
const mockSchema = jest.mocked(formVersionService.readSchema);
const mockHash = jest.mocked(formVersionService.schemaHash);
const service = jest.mocked(submissionsApiService);

// Stands in for checkJwt + resolveActorOrPublic, which need a signed token. The router, guards and
// @soba/lib rules are real; the reads and services they call are stubbed.
function buildApp(caller: 'signedIn' | 'anonymous') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (caller === 'signedIn') {
      req.user = {
        providerCode: 'idir',
        profile: { displayLabel: 'Signed In' },
      } as unknown as Express.User;
      req.actorId = 'u1';
    } else {
      req.actorId = 'public-user';
      req.idpType = 'public';
    }
    next();
  });
  app.use('/api/v1/submit', submitRouter);
  app.use(coreErrorHandler);
  return app;
}

const signedIn = () => request(buildApp('signedIn'));
const anonymous = () => request(buildApp('anonymous'));
const BASE = '/api/v1/submit/submissions';
const writeBody = {
  data: { a: 1 },
  revisionId: '01a12d03-761e-70a8-9eb2-b5113a6cb3e5',
  baseRevisionId: '01a12d03-7640-748f-b008-2c331de67244',
};
const submitterForm = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1',
  name: 'Permit application',
  workspaceId: 'ws9',
  workspaceName: 'Roads',
  publishedVersionId: 'v1',
  permissions: ['submission_create'],
  audienceMode: 'members' as const,
  audienceIdps: [],
  allowSubmitterDrafts: true,
  allowSubmitterRevision: false,
  ...overrides,
});

// Refused as an open is: the caller may not start (401 anonymous, 403 signed in), then no published
// version.
const START_REFUSALS = [
  ['a missing form', null, 'signedIn', 404, 'Form not found', 'form_not_found'],
  [
    'a form with no published version',
    submitterForm({ publishedVersionId: null }),
    'signedIn',
    404,
    'Form has no published version',
    'not_published',
  ],
  [
    'a members form, anonymously',
    submitterForm({ permissions: [] }),
    'anonymous',
    401,
    'Not authorized to submit this form',
    'open_denied',
  ],
  [
    'a members form without the role',
    submitterForm({ permissions: [] }),
    'signedIn',
    403,
    'Not authorized to submit this form',
    'open_denied',
  ],
] as const;

beforeEach(() => {
  jest.resetAllMocks();
  mockRead.mockResolvedValue(storedSubmission());
  mockSchema.mockResolvedValue({ components: [] });
  service.readContent.mockResolvedValue({ data: { a: 1 } });
});

describe('submit routes over one read', () => {
  it('reads the submission once, as the caller, the public user without permissions', async () => {
    await signedIn().get(`${BASE}/s1/fill`);
    await anonymous().get(`${BASE}/s1/fill`);
    expect(mockRead.mock.calls).toEqual([
      [{ submissionId: 's1', actorId: 'u1', idpCode: 'idir' }],
      [{ submissionId: 's1', actorId: 'public-user', idpCode: 'public' }],
    ]);
  });

  it('builds the fill bundle from the read and its engine refs', async () => {
    const res = await signedIn().get(`${BASE}/s1/fill`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      formId: 'f1',
      workflowState: 'draft',
      formVersionId: 'v1',
      headRevisionId: 'r1',
      currentRevisionNo: 1,
      role: 'owner',
      form: {
        id: 'f1',
        name: 'Permit application',
        workspaceId: 'ws1',
        workspaceName: 'Roads',
        publishedVersionId: 'v1',
        permissions: ['submission_create', 'document_template_read'],
        audienceMode: 'members',
        audienceIdps: [],
        allowSubmitterDrafts: true,
        allowSubmitterRevision: false,
      },
      schema: { components: [] },
      content: { data: { a: 1 } },
    });
    expect(mockSchema).toHaveBeenCalledWith({
      engineCode: 'formio-v5',
      engineSchemaRef: 'engine-form',
    });
    expect(service.readContent).toHaveBeenCalledWith({
      engineCode: 'formio-v5',
      engineSchemaRef: 'engine-form',
      engineSubmissionRef: 'engine-submission',
    });
  });

  it("reports a collaborator's role in the fill bundle", async () => {
    mockRead.mockResolvedValue(storedSubmission({ role: 'collaborator' }));
    const res = await signedIn().get(`${BASE}/s1/fill`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('collaborator');
  });

  it('serves the form facts the page decides from, whatever they allow', async () => {
    mockRead.mockResolvedValue(
      storedSubmission({ form: { permissions: [], allowSubmitterDrafts: false } }),
    );
    const res = await signedIn().get(`${BASE}/s1/fill`);
    expect(res.status).toBe(200);
    expect(res.body.form).toMatchObject({ permissions: [], allowSubmitterDrafts: false });
    expect(res.body).not.toHaveProperty('canWrite');
    expect(res.body).not.toHaveProperty('canSaveDraft');
  });

  it('answers the submission from the read, its code hidden until submitted', async () => {
    const res = await signedIn().get(`${BASE}/s1`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 's1',
      formName: 'Permit application',
      versionNo: 3,
      workflowState: 'draft',
      confirmationCode: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('answers the saved answers, or 404 before the first write', async () => {
    expect((await signedIn().get(`${BASE}/s1/data`)).body).toEqual({ data: { a: 1 } });
    service.readContent.mockResolvedValue(null);
    const res = await signedIn().get(`${BASE}/s1/data`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('content_not_found');
  });

  it.each(['/schema', '/fill'])('answers 404 when GET %s finds no schema', async (path) => {
    mockSchema.mockResolvedValue(null);
    const res = await signedIn().get(`${BASE}/s1${path}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('schema_not_found');
  });

  it.each(['', '/data', '/schema', '/fill'])(
    'answers 404 when GET %s finds nothing live',
    async (path) => {
      mockRead.mockResolvedValue(null);
      const res = await signedIn().get(`${BASE}/s1${path}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('submission_not_found');
    },
  );

  it('refuses a read without a grant, 403 signed in and 401 anonymous', async () => {
    mockRead.mockResolvedValue(storedSubmission({ role: null }));
    const signedInRes = await signedIn().get(`${BASE}/s1`);
    expect(signedInRes.status).toBe(403);
    expect(signedInRes.body.code).toBe('read_denied');
    const anonymousRes = await anonymous().get(`${BASE}/s1`);
    expect(anonymousRes.status).toBe(401);
    expect(anonymousRes.body.code).toBe('read_denied');
  });

  it.each([
    [
      'drafts off',
      { form: { allowSubmitterDrafts: false } },
      'Drafts are not enabled for this form',
      'drafts_disabled',
    ],
    [
      'no submit permission',
      { form: { permissions: [] } },
      'Not authorized to change this submission',
      'write_denied',
    ],
  ])('refuses a save with %s, 403', async (_label, overrides, error, code) => {
    mockRead.mockResolvedValue(storedSubmission(overrides));
    const res = await signedIn().post(`${BASE}/s1/save`).send(writeBody);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error, code });
    expect(service.save).not.toHaveBeenCalled();
  });

  it('refuses an anonymous save on a public form with 403, not 401', async () => {
    mockRead.mockResolvedValue(
      storedSubmission({ form: { audienceMode: 'public', permissions: [] } }),
    );
    const res = await anonymous().post(`${BASE}/s1/save`).send(writeBody);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Drafts are not available on a public form',
      code: 'drafts_public',
    });
  });

  it.each([
    ['post', '/save'],
    ['post', '/submit'],
    ['delete', ''],
  ] as const)('answers 404 when %s %s finds nothing live', async (method, path) => {
    mockRead.mockResolvedValue(null);
    const call = signedIn()[method](`${BASE}/s1${path}`);
    const res = method === 'post' ? await call.send(writeBody) : await call;
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('submission_not_found');
  });

  it('saves as the caller, in the submission workspace', async () => {
    service.save.mockResolvedValue({ id: 's1' } as never);
    const res = await signedIn().post(`${BASE}/s1/save`).send(writeBody);
    expect(res.status).toBe(200);
    expect(service.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        actorId: 'u1',
        actorDisplayLabel: 'Signed In',
      }),
      's1',
      writeBody,
    );
  });

  const recordedSave = {
    submissionId: 's1',
    eventType: 'saved',
    changedBy: 'u1',
    revisionNo: 2,
    status: 'current',
    reason: 'accepted',
  };

  it('answers a recorded save with where it landed, though drafts are now off', async () => {
    mockRead.mockResolvedValue(storedSubmission({ form: { allowSubmitterDrafts: false } }));
    mockRevision.mockResolvedValue(recordedSave);
    const res = await signedIn().post(`${BASE}/s1/save`).send(writeBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 's1',
      headRevisionId: 'r1',
      revision: { id: writeBody.revisionId, revisionNo: 2, status: 'current', reason: 'accepted' },
    });
    expect(mockRevision).toHaveBeenCalledWith(writeBody.revisionId);
    expect(service.save).not.toHaveBeenCalled();
  });

  it('answers a recorded submit, though the submit permission is gone', async () => {
    mockRead.mockResolvedValue(
      storedSubmission({ workflowState: 'submitted', form: { permissions: [] } }),
    );
    mockRevision.mockResolvedValue({ ...recordedSave, eventType: 'submitted' });
    const res = await signedIn().post(`${BASE}/s1/submit`).send(writeBody);
    expect(res.status).toBe(200);
    expect(res.body.revision).toMatchObject({ status: 'current', revisionNo: 2 });
    expect(service.submit).not.toHaveBeenCalled();
  });

  it.each([
    ['another actor', { changedBy: 'u2' }],
    ['another event', { eventType: 'submitted' }],
  ])('refuses a revision id recorded by %s with 409', async (_label, over) => {
    mockRevision.mockResolvedValue({ ...recordedSave, ...over });
    const res = await signedIn().post(`${BASE}/s1/save`).send(writeBody);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('revision_id_taken');
    expect(service.save).not.toHaveBeenCalled();
  });

  it('gives no recorded answer without a grant, 403 signed in and 401 anonymous', async () => {
    mockRead.mockResolvedValue(storedSubmission({ role: null }));
    mockRevision.mockResolvedValue(recordedSave);
    expect((await signedIn().post(`${BASE}/s1/save`).send(writeBody)).status).toBe(403);
    expect((await anonymous().post(`${BASE}/s1/save`).send(writeBody)).status).toBe(401);
    expect(mockRevision).not.toHaveBeenCalled();
  });

  it('refuses a submit without the submit permission, 403 signed in and 401 anonymous', async () => {
    mockRead.mockResolvedValue(storedSubmission({ form: { permissions: [] } }));
    const signedInRes = await signedIn().post(`${BASE}/s1/submit`).send(writeBody);
    expect(signedInRes.status).toBe(403);
    expect(signedInRes.body.code).toBe('write_denied');
    const anonymousRes = await anonymous().post(`${BASE}/s1/submit`).send(writeBody);
    expect(anonymousRes.status).toBe(401);
    expect(anonymousRes.body.code).toBe('write_denied');
    expect(service.submit).not.toHaveBeenCalled();
  });

  it('passes a submit on a submitted submission to the service, which holds it', async () => {
    mockRead.mockResolvedValue(storedSubmission({ workflowState: 'submitted' }));
    service.submit.mockResolvedValue({ id: 's1' } as never);
    expect((await signedIn().post(`${BASE}/s1/submit`).send(writeBody)).status).toBe(200);
  });

  it.each([
    ['a collaborator', { role: 'collaborator' }, 403, 'delete_denied'],
    ['the owner, once submitted', { workflowState: 'submitted' }, 409, 'delete_closed'],
    ['the owner of a draft', {}, 204, undefined],
  ])('answers a delete by %s with %s', async (_label, overrides, status, code) => {
    mockRead.mockResolvedValue(storedSubmission(overrides));
    service.deleteUnsubmitted.mockResolvedValue({ id: 's1' } as never);
    const res = await signedIn().delete(`${BASE}/s1`);
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });

  it('answers a delete of a submission removed after the load with submission_not_found', async () => {
    service.deleteUnsubmitted.mockResolvedValue(null as never);
    const res = await signedIn().delete(`${BASE}/s1`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('submission_not_found');
  });

  const openBody = { id: '01a12d03-75a8-73bc-a106-ce3787ee9a1e', formId: 'f1' };

  it('answers an open of an id the caller owns with it, without reading the form', async () => {
    const res = await signedIn().post(BASE).send(openBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 's1', formId: 'f1', workflowState: 'draft' });
    expect(mockRead).toHaveBeenCalledWith({
      submissionId: openBody.id,
      actorId: 'u1',
      idpCode: 'idir',
    });
    expect(mockForm).not.toHaveBeenCalled();
    expect(service.open).not.toHaveBeenCalled();
  });

  // Postgres stores ids lower-case; a link spelled upper-case must still replay its own open.
  it('answers an open spelled in another case with the submission it already opened', async () => {
    const res = await signedIn().post(BASE).send({ id: openBody.id.toUpperCase(), formId: 'F1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 's1', formId: 'f1' });
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ submissionId: openBody.id }));
    expect(service.open).not.toHaveBeenCalled();
  });

  it.each([
    ['nothing live', null],
    ['a collaborator', storedSubmission({ role: 'collaborator' })],
    ['no grant', storedSubmission({ role: null })],
  ])('decides an open on its form when the id holds %s', async (_label, stored) => {
    mockRead.mockResolvedValue(stored);
    mockForm.mockResolvedValue(submitterForm({ publishedVersionId: null }));
    const res = await signedIn().post(BASE).send(openBody);
    expect(res.status).toBe(404);
    expect(mockForm).toHaveBeenCalled();
  });

  it.each([
    ['another form', { ...openBody, formId: 'f2' }],
    ['another version', { ...openBody, formVersionId: '01a12d03-7640-748f-b008-2c331de67244' }],
  ])('decides an open on its form when it names %s', async (_label, body) => {
    mockForm.mockResolvedValue(null);
    expect((await signedIn().post(BASE).send(body)).status).toBe(404);
    expect(mockForm).toHaveBeenCalled();
  });

  it('reads the form once to open, as the caller, the public user without permissions', async () => {
    mockRead.mockResolvedValue(null);
    mockForm.mockResolvedValue(null);
    await signedIn().post(BASE).send(openBody);
    await anonymous().post(BASE).send(openBody);
    expect(mockForm.mock.calls).toEqual([
      [{ userId: 'u1', formId: 'f1' }],
      [{ userId: null, formId: 'f1' }],
    ]);
  });

  it.each(START_REFUSALS)(
    'refuses an open of %s',
    async (_label, form, caller, status, error, code) => {
      mockRead.mockResolvedValue(null);
      mockForm.mockResolvedValue(form);
      const res = await request(buildApp(caller)).post(BASE).send(openBody);
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error, code });
      expect(service.open).not.toHaveBeenCalled();
    },
  );

  it('opens in the form workspace', async () => {
    mockRead.mockResolvedValue(null);
    mockForm.mockResolvedValue(submitterForm());
    service.open.mockResolvedValue({ created: true, submission: { id: openBody.id } } as never);
    const res = await signedIn().post(BASE).send(openBody);
    expect(res.status).toBe(201);
    expect(service.open).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws9', formId: 'f1', actorId: 'u1' }),
      openBody,
    );
  });
});

describe('submit reads to start a submission', () => {
  const version = {
    id: 'v1',
    formId: 'f1',
    versionNo: 3,
    engineSchemaRef: 'engine-form',
    formEngineCode: 'formio-v5',
  };
  const SCHEMA_PATH = '/api/v1/submit/form-versions/v1/schema';
  const publicForm = submitterForm({ audienceMode: 'public', permissions: [] });

  it('serves the form a caller may start, read once as the caller', async () => {
    mockForm.mockResolvedValue(submitterForm());
    const res = await signedIn().get('/api/v1/submit/forms/f1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(submitterForm());
    expect(mockForm.mock.calls).toEqual([[{ userId: 'u1', formId: 'f1' }]]);
  });

  it('serves a public form anonymously, read without permissions', async () => {
    mockForm.mockResolvedValue(publicForm);
    const res = await anonymous().get('/api/v1/submit/forms/f1');
    expect(res.status).toBe(200);
    expect(mockForm.mock.calls).toEqual([[{ userId: null, formId: 'f1' }]]);
  });

  it.each(START_REFUSALS)(
    'refuses a form read of %s as an open',
    async (_label, form, caller, status, error, code) => {
      mockForm.mockResolvedValue(form);
      const res = await request(buildApp(caller)).get('/api/v1/submit/forms/f1');
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error, code });
    },
  );

  it('serves the published version schema with its hash, read once as the caller', async () => {
    mockVersion.mockResolvedValue({ version, form: submitterForm() });
    mockHash.mockReturnValue('rendered-hash');
    const res = await signedIn().get(SCHEMA_PATH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      formId: 'f1',
      formVersionId: 'v1',
      versionNo: 3,
      schema: { components: [] },
      schemaHash: 'rendered-hash',
    });
    expect(mockHash).toHaveBeenCalledWith({ engineCode: 'formio-v5', schema: { components: [] } });
    expect(mockVersion.mock.calls).toEqual([[{ userId: 'u1', formVersionId: 'v1' }]]);
    expect(mockSchema).toHaveBeenCalledWith({
      engineCode: 'formio-v5',
      engineSchemaRef: 'engine-form',
    });
  });

  it('serves a public form version schema anonymously, read without permissions', async () => {
    mockVersion.mockResolvedValue({ version, form: publicForm });
    expect((await anonymous().get(SCHEMA_PATH)).status).toBe(200);
    expect(mockVersion.mock.calls).toEqual([[{ userId: null, formVersionId: 'v1' }]]);
  });

  it.each([
    [
      'a missing version',
      null,
      'signedIn',
      404,
      'Form version schema not found',
      'schema_not_found',
    ],
    [
      'a members form, anonymously',
      { version, form: submitterForm({ permissions: [] }) },
      'anonymous',
      401,
      'Not authorized to submit this form',
      'open_denied',
    ],
    [
      'a replaced version, to a caller who may not start',
      { version, form: submitterForm({ permissions: [], publishedVersionId: 'v2' }) },
      'signedIn',
      403,
      'Not authorized to submit this form',
      'open_denied',
    ],
    [
      'a form with no published version',
      { version, form: submitterForm({ publishedVersionId: null }) },
      'signedIn',
      404,
      'Form has no published version',
      'not_published',
    ],
    [
      'a replaced version',
      { version, form: submitterForm({ publishedVersionId: 'v2' }) },
      'signedIn',
      409,
      'Form version is not the published version',
      'version_not_published',
    ],
  ] as const)(
    'refuses a schema read of %s, before the engine read',
    async (_label, loaded, caller, status, error, code) => {
      mockVersion.mockResolvedValue(loaded);
      const res = await request(buildApp(caller)).get(SCHEMA_PATH);
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error, code });
      expect(mockSchema).not.toHaveBeenCalled();
    },
  );

  it('answers a published version without an engine schema with schema_not_found', async () => {
    mockVersion.mockResolvedValue({ version, form: submitterForm() });
    mockSchema.mockResolvedValue(null);
    const res = await signedIn().get(SCHEMA_PATH);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Form version schema not found', code: 'schema_not_found' });
  });
});
