import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteCredential,
  getCredential,
  issueCredential,
  listCredentials,
  regenerateCredential,
  updateCredential,
} from '@/src/features/credentials/data/api';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/src/shared/api/sobaFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/shared/api/sobaFetch')>()),
  sobaFetch: mocks.fetch,
}));

const credential = {
  id: '01900000-0000-7000-8000-000000000001',
  scope: 'form',
  label: 'Integration',
  notes: '',
  types: ['api'],
  status: 'active',
  createdAt: '2026-10-09T15:53:52Z',
  updatedAt: '2026-10-09T15:53:52Z',
  rotatedAt: null,
};
const query = { offset: 0, limit: 10, sort: 'createdAt:desc' };
const page = { offset: 0, limit: 10, total: 0 };
const fields = { label: 'Integration', notes: '', types: ['api' as const] };
const form = { kind: 'form' as const, id: 'form/id' };
const workspace = { kind: 'workspace' as const, id: 'workspace' };
const formKeys = '/design/forms/form%2Fid/settings/api-keys';
const workspaceKey = `/workspaces/workspace/settings/api-keys/${credential.id}`;

beforeEach(() => vi.resetAllMocks());

describe('credential API', () => {
  it("uses the settings group's paths at each level", async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ available: true, items: [], page, filters: {}, sort: query.sort }),
    );
    await listCredentials('token', form, query);
    expect(mocks.fetch).toHaveBeenLastCalledWith(formKeys, {
      token: 'token',
      query,
      headers: {},
    });

    mocks.fetch.mockResolvedValueOnce(Response.json({ credential, apiKey: 'secret' }));
    await issueCredential('token', form, fields);
    expect(mocks.fetch).toHaveBeenLastCalledWith(formKeys, {
      token: 'token',
      method: 'POST',
      json: fields,
    });

    mocks.fetch.mockResolvedValueOnce(Response.json(credential));
    await getCredential('token', workspace, credential.id);
    expect(mocks.fetch).toHaveBeenLastCalledWith(workspaceKey, { token: 'token' });

    mocks.fetch.mockResolvedValueOnce(Response.json(credential));
    await updateCredential('token', workspace, credential.id, fields);
    expect(mocks.fetch).toHaveBeenLastCalledWith(workspaceKey, {
      token: 'token',
      method: 'PATCH',
      json: fields,
    });

    mocks.fetch.mockResolvedValueOnce(Response.json({ credential, apiKey: 'secret' }));
    await regenerateCredential('token', workspace, credential.id);
    expect(mocks.fetch).toHaveBeenLastCalledWith(`${workspaceKey}/regenerate`, {
      token: 'token',
      method: 'POST',
      json: {},
    });

    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteCredential('token', workspace, credential.id);
    expect(mocks.fetch).toHaveBeenLastCalledWith(workspaceKey, {
      token: 'token',
      method: 'DELETE',
    });
  });

  it.each([
    { available: true, items: {} },
    { available: true, items: [{ ...credential, scope: undefined }] },
    { available: true, items: [{ ...credential, types: ['unsupported'] }] },
    { available: true, items: [{ ...credential, status: 'revoked' }] },
  ])('rejects a malformed list before it renders: %j', async (body) => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ page, filters: {}, sort: query.sort, ...body }),
    );
    await expect(listCredentials('token', workspace, query)).rejects.toThrow();
  });

  it('rejects a malformed generate response', async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ credential: { ...credential, types: null }, apiKey: 'one-time-secret' }),
    );
    await expect(issueCredential('token', workspace, fields)).rejects.toThrow();
  });

  it('surfaces HTTP errors, a refused delete included', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: 'Forbidden' }, { status: 403 }));
    await expect(listCredentials('token', workspace, query)).rejects.toEqual(
      new ApiError('Forbidden', 403),
    );
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: 'Pending' }, { status: 409 }));
    await expect(deleteCredential('token', workspace, credential.id)).rejects.toEqual(
      new ApiError('Pending', 409),
    );
  });
});
