jest.mock('../../../src/core/db/repos/formAccessRepo', () => ({
  resolveFormPermissions: jest.fn(),
}));
jest.mock('../../../src/core/services/featureAvailabilityService', () => ({
  isFeatureAvailable: jest.fn(),
}));
import { resolveFormPermissions } from '../../../src/core/db/repos/formAccessRepo';
import { isFeatureAvailable } from '../../../src/core/services/featureAvailabilityService';
import { Features, Permissions } from '../../../src/core/db/codes';
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../../src/core/errors';
jest.mock('../../../src/core/middleware/workspaceContext', () => ({
  workspaceFromResource:
    ({ kind }: { kind: string }) =>
    (req: Request, _res: Response, next: NextFunction) => {
      const role = req.headers['x-test-role'];
      if (typeof role !== 'string') return next(new ForbiddenError('Membership required'));
      req.coreContext = {
        workspaceId:
          kind === 'form' ? '01900000-0000-7000-8000-000000000001' : String(req.params.id),
        ...(kind === 'form' ? { formId: String(req.params.id) } : {}),
        actorId: 'actor',
        actorDisplayLabel: null,
        workspaceSource: 'workspace',
        role,
      };
      next();
    },
}));
jest.mock('../../../src/features/credentials/service', () => ({
  credentialService: {
    list: jest.fn(),
    get: jest.fn(),
    issue: jest.fn(),
    update: jest.fn(),
    regenerate: jest.fn(),
    remove: jest.fn(),
  },
}));
import express from 'express';
import request from 'supertest';
import { buildOpenApiDocument } from '../../../src/core/api/shared/openapi';
import { registerApiKeySettingsOpenApi } from '../../../src/features/credentials/schema';
import { credentialService } from '../../../src/features/credentials/service';
import {
  formSettingsRouter,
  workspaceSettingsRouter,
} from '../../../src/features/form-settings/router';
import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';

const service = jest.mocked(credentialService);
const workspaceId = '01900000-0000-7000-8000-000000000001';
const formId = '01900000-0000-7000-8000-000000000003';
const credentialId = '01900000-0000-7000-8000-000000000002';
const workspacePath = `/workspaces/${workspaceId}/settings/api-keys`;
const formPath = `/design/forms/${formId}/settings/api-keys`;
const workspaceOwner = { workspaceId, formId: null };
const formOwner = { workspaceId, formId };
const fields = { label: 'Embedding', notes: '', types: ['api', 'web-component'] };
const query = { offset: 0, limit: 20, sort: 'createdAt:desc', locale: 'en' };

const app = express();
app.use(express.json());
app.use('/design/forms/:id/settings', formSettingsRouter);
app.use('/workspaces/:id/settings', workspaceSettingsRouter);
app.use(coreErrorHandler);

const grant = (...codes: string[]) =>
  jest.mocked(resolveFormPermissions).mockResolvedValue(new Set(codes) as never);

/** Each write the group serves, as a request builder. */
const writes = (base: string) => [
  () => request(app).post(base).send(fields),
  () => request(app).patch(`${base}/${credentialId}`).send(fields),
  () => request(app).post(`${base}/${credentialId}/regenerate`).send({}),
  () => request(app).delete(`${base}/${credentialId}`),
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isFeatureAvailable).mockResolvedValue(true);
  grant();
  service.list.mockResolvedValue({
    available: true,
    items: [],
    page: { offset: 0, limit: 20, total: 0 },
    filters: {},
    sort: 'createdAt:desc',
  });
});

describe('api keys settings group', () => {
  it('answers 404 at both levels while the api-keys feature is off', async () => {
    jest.mocked(isFeatureAvailable).mockResolvedValue(false);
    grant(Permissions.form_update, Permissions.form_read);
    for (const path of [workspacePath, formPath]) {
      expect((await request(app).get(path).set('x-test-role', 'owner')).status).toBe(404);
    }
    expect(isFeatureAvailable).toHaveBeenCalledWith(Features.api_keys, expect.anything());
    expect(service.list).not.toHaveBeenCalled();
  });

  it("lets any workspace member read the workspace's keys", async () => {
    const response = await request(app)
      .get(`${workspacePath}?offset=10&limit=5&q=Vault&sort=label:asc`)
      .set('x-test-role', 'viewer')
      .set('Accept-Language', 'fr-CA');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.list).toHaveBeenCalledWith(workspaceOwner, {
      offset: 10,
      limit: 5,
      q: 'Vault',
      sort: 'label:asc',
      locale: 'fr',
    });
  });

  it("refuses a member every write to the workspace's keys, uncached", async () => {
    for (const write of writes(workspacePath)) {
      const response = await write().set('x-test-role', 'member');
      expect(response.status).toBe(403);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    for (const call of [service.issue, service.update, service.regenerate, service.remove]) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("lets an owner or admin change the workspace's keys", async () => {
    service.issue.mockResolvedValue({ apiKey: 'secret' } as never);
    const issued = await request(app).post(workspacePath).set('x-test-role', 'admin').send(fields);
    expect(issued.status).toBe(201);
    expect(issued.headers['cache-control']).toBe('no-store');
    expect(service.issue).toHaveBeenCalledWith(workspaceOwner, 'actor', fields);

    const patched = await request(app)
      .patch(`${workspacePath}/${credentialId}`)
      .set('x-test-role', 'owner')
      .send(fields);
    expect(patched.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith(workspaceOwner, credentialId, 'actor', fields);

    const regenerated = await request(app)
      .post(`${workspacePath}/${credentialId}/regenerate`)
      .set('x-test-role', 'owner')
      .send({});
    expect(regenerated.status).toBe(200);
    expect(regenerated.headers['cache-control']).toBe('no-store');
    expect(service.regenerate).toHaveBeenCalledWith(workspaceOwner, credentialId, 'actor');

    const deleted = await request(app)
      .delete(`${workspacePath}/${credentialId}`)
      .set('x-test-role', 'owner');
    expect(deleted.status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(workspaceOwner, credentialId, 'actor');
  });

  it("reads a form's keys with form_read and refuses its writes without form_update", async () => {
    grant(Permissions.form_read);
    expect((await request(app).get(formPath).set('x-test-role', 'member')).status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(formOwner, query);
    expect(resolveFormPermissions).toHaveBeenCalledWith('actor', workspaceId, formId);
    for (const write of writes(formPath)) {
      expect((await write().set('x-test-role', 'owner')).status).toBe(403);
    }
    expect(service.issue).not.toHaveBeenCalled();
  });

  it("refuses a form's keys to a member without form_read", async () => {
    const response = await request(app).get(formPath).set('x-test-role', 'member');
    expect(response.status).toBe(403);
    expect(service.list).not.toHaveBeenCalled();
  });

  it("changes a form's keys with form_update, owned by the resolved form", async () => {
    grant(Permissions.form_update);
    service.issue.mockResolvedValue({ apiKey: 'secret' } as never);
    expect(
      (await request(app).post(formPath).set('x-test-role', 'member').send(fields)).status,
    ).toBe(201);
    expect(service.issue).toHaveBeenCalledWith(formOwner, 'actor', fields);
    expect(
      (
        await request(app)
          .patch(`${formPath}/${credentialId}`)
          .set('x-test-role', 'member')
          .send(fields)
      ).status,
    ).toBe(200);
    expect(service.update).toHaveBeenCalledWith(formOwner, credentialId, 'actor', fields);
    expect(
      (
        await request(app)
          .post(`${formPath}/${credentialId}/regenerate`)
          .set('x-test-role', 'member')
          .send({})
      ).status,
    ).toBe(200);
    expect(service.regenerate).toHaveBeenCalledWith(formOwner, credentialId, 'actor');
    expect(
      (await request(app).delete(`${formPath}/${credentialId}`).set('x-test-role', 'member'))
        .status,
    ).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(formOwner, credentialId, 'actor');
  });

  it.each(['limit=101', 'offset=-1', 'cursor=old', 'sort=unsupported:asc', 'q=%20'])(
    'rejects the list query %s',
    async (params) => {
      const response = await request(app)
        .get(`${workspacePath}?${params}`)
        .set('x-test-role', 'admin');
      expect(response.status).toBe(400);
      expect(service.list).not.toHaveBeenCalled();
    },
  );

  it('rejects caller-supplied ownership, repeated types, a bad key id and a regenerate body', async () => {
    for (const body of [
      { ...fields, workspaceId },
      { ...fields, formId },
      { ...fields, types: ['api', 'api'] },
    ]) {
      expect(
        (await request(app).post(workspacePath).set('x-test-role', 'admin').send(body)).status,
      ).toBe(400);
    }
    expect(
      (await request(app).get(`${workspacePath}/not-a-uuid`).set('x-test-role', 'admin')).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`${workspacePath}/${credentialId}/regenerate`)
          .set('x-test-role', 'admin')
          .send({ clientId: 'other' })
      ).status,
    ).toBe(400);
    expect(service.issue).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
    expect(service.regenerate).not.toHaveBeenCalled();
  });

  it('documents both levels, each with the key routes', () => {
    const document = buildOpenApiDocument([registerApiKeySettingsOpenApi]);
    for (const base of [
      '/workspaces/{id}/settings/api-keys',
      '/design/forms/{id}/settings/api-keys',
    ]) {
      const collection = document.paths[base]!;
      const key = document.paths[`${base}/{credentialId}`]!;
      expect(collection.get?.security).toEqual([{ bearerAuth: [] }]);
      expect(collection.post?.responses['201']).toBeDefined();
      expect(key.get && key.patch && key.delete).toBeTruthy();
      expect(document.paths[`${base}/{credentialId}/regenerate`]?.post).toBeDefined();
    }
  });
});
