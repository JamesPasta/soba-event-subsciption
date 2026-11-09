import { describe, expect, it, vi } from 'vitest';

const { mockSobaFetch } = vi.hoisted(() => ({ mockSobaFetch: vi.fn() }));

vi.mock('@/src/shared/api/sobaFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/shared/api/sobaFetch')>()),
  sobaFetch: mockSobaFetch,
}));

import {
  deleteWorkspaceGroup,
  getWorkspaceGroup,
  listWorkspaceGroups,
} from '@/src/features/workspaces/data/api';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('workspace groups api', () => {
  it('asks the server for one page, sending the sort locale as the param and the header', async () => {
    mockSobaFetch.mockResolvedValueOnce(ok({ items: [] }));

    await listWorkspaceGroups('tok', 'ws-1', {
      offset: 20,
      limit: 10,
      sort: 'name:desc',
      q: 'review',
      locale: 'fr',
    });

    expect(mockSobaFetch).toHaveBeenCalledWith('/workspaces/ws-1/groups', {
      token: 'tok',
      query: { offset: 20, limit: 10, sort: 'name:desc', q: 'review', locale: 'fr' },
      headers: { 'Accept-Language': 'fr' },
    });
  });

  it('leaves an empty search out of the request', async () => {
    mockSobaFetch.mockResolvedValueOnce(ok({ items: [] }));

    await listWorkspaceGroups('tok', 'ws-1', { offset: 0, limit: 10, sort: 'name:asc', q: '' });

    expect(mockSobaFetch.mock.calls.at(-1)?.[1].query).not.toHaveProperty('q');
  });

  it('reads one group in the sort locale', async () => {
    mockSobaFetch.mockResolvedValueOnce(ok({ id: 'grp-1' }));

    await getWorkspaceGroup('tok', 'ws-1', 'grp-1', 'en');

    expect(mockSobaFetch).toHaveBeenCalledWith('/workspaces/ws-1/groups/grp-1', {
      token: 'tok',
      query: { locale: 'en' },
      headers: { 'Accept-Language': 'en' },
    });
  });

  it.each([403, 500])('throws on a %i delete so the caller reports the failure', async (status) => {
    mockSobaFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status }));
    await expect(deleteWorkspaceGroup('tok', 'ws-1', 'grp-1')).rejects.toBeInstanceOf(ApiError);
  });

  it('counts a 404 delete as deleted', async () => {
    mockSobaFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(deleteWorkspaceGroup('tok', 'ws-1', 'grp-1')).resolves.toBeUndefined();
  });
});
