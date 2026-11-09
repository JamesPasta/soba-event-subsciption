import { createFormsApiService } from '../../../../src/core/api/forms/serviceFactory';
import type { FormService } from '../../../../src/core/services/formService';
import type { FormVersionService } from '../../../../src/core/services/formVersionService';

const query = {
  offset: 10,
  limit: 5,
  workspaceId: 'ws1',
  q: 'permit',
  sort: 'name:asc' as const,
  locale: 'fr' as const,
};

const row = {
  id: 'f1',
  name: 'Permit',
  workspaceId: 'ws1',
  workspaceName: 'Licensing',
  publishedVersionId: 'v1',
  permissions: ['submission_create'],
  audienceMode: 'protected' as const,
  audienceIdps: ['idir'],
  allowSubmitterDrafts: true,
};

const apiWith = (listForSubmitter: jest.Mock) =>
  createFormsApiService(
    { listForSubmitter } as unknown as FormService,
    {} as unknown as FormVersionService,
  );

describe("listMine: the caller's forms", () => {
  it('reads as the caller with the declared query fields only', async () => {
    const listForSubmitter = jest.fn().mockResolvedValue({ items: [], total: 0 });

    await apiWith(listForSubmitter).listMine('u1', {
      ...query,
      includeDeleted: true,
    } as typeof query);

    expect(listForSubmitter).toHaveBeenCalledWith({ userId: 'u1', ...query });
    expect(Object.keys(listForSubmitter.mock.calls[0][0]).sort()).toEqual([
      'limit',
      'locale',
      'offset',
      'q',
      'sort',
      'userId',
      'workspaceId',
    ]);
  });

  it('returns each row with the facts the access rules read, and echoes the query', async () => {
    const api = apiWith(jest.fn().mockResolvedValue({ items: [row], total: 12 }));

    const result = await api.listMine('u1', query);

    expect(result.items).toEqual([row]);
    expect(result.page).toEqual({ offset: 10, limit: 5, total: 12 });
    expect(result.filters).toEqual({ workspaceId: 'ws1', q: 'permit' });
    expect(result.sort).toBe('name:asc');
  });
});
