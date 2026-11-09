import { createFormsApiService } from '../../../../src/core/api/forms/serviceFactory';
import type { FormService } from '../../../../src/core/services/formService';
import type { FormVersionService } from '../../../../src/core/services/formVersionService';
import type { CoreRequestContext } from '../../../../src/core/middleware/requestContext';

const formRow = {
  id: 'f1',
  workspaceId: 'ws1',
  name: 'Permit',
  description: null,
  org: 'CITZ',
  useCase: 'application',
  status: 'active',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  createdBy: 'admin',
  updatedBy: 'admin',
};

const ctx = (permissions?: ReadonlySet<string>): CoreRequestContext => ({
  workspaceId: 'ws1',
  formId: 'f1',
  actorId: 'actor1',
  actorDisplayLabel: 'Actor One',
  workspaceSource: 'resource:form',
  role: 'member',
  ...(permissions ? { permissions } : {}),
});

const api = () =>
  createFormsApiService(
    { get: jest.fn().mockResolvedValue(formRow) } as unknown as FormService,
    { getCurrent: jest.fn().mockResolvedValue(null) } as unknown as FormVersionService,
  );

describe("getForm: the caller's permissions on the form", () => {
  it('returns the codes requireFormPermissions resolved, sorted', async () => {
    const result = await api().getForm(ctx(new Set(['form_read', 'design_update'])), 'f1');

    expect(result?.permissions).toEqual(['design_update', 'form_read']);
  });

  it('returns none when no codes were resolved', async () => {
    const result = await api().getForm(ctx(), 'f1');

    expect(result?.permissions).toEqual([]);
  });
});
