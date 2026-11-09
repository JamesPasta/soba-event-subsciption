import { createSubmissionsApiService } from '../../../../src/core/api/submissions/serviceFactory';
import type { SubmissionService } from '../../../../src/core/services/submissionService';

const SCOPE = {
  workspaceIds: ['ws1'],
  actorId: 'u1',
  formAccess: { workspaceIds: ['ws1'], overriddenFormIds: [], includedFormIds: [] },
};

const row = (workflowState: string) => ({
  id: 's1',
  formId: 'f1',
  form: { name: 'Form One' },
  formVersionId: 'v1',
  formVersion: { versionNo: 1 },
  workflowState,
  engineSyncStatus: 'ready',
  currentRevisionNo: 1,
  headRevisionId: 'r1',
  submittedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  createdBy: 'Ada',
  submittedBy: 'u1',
  confirmationCode: 'K7M2Q9XA',
});

const ctx = { workspaceId: 'ws1' } as Parameters<
  ReturnType<typeof createSubmissionsApiService>['get']
>[0];

const serviceWith = (workflowState: string) =>
  createSubmissionsApiService({
    get: jest.fn().mockResolvedValue(row(workflowState)),
    list: jest.fn().mockResolvedValue({ items: [row(workflowState)], total: 1 }),
  } as unknown as SubmissionService);

const listQuery = { offset: 0, limit: 10, sort: 'updatedAt:desc', locale: 'en' } as Parameters<
  ReturnType<typeof createSubmissionsApiService>['list']
>[1];

describe('confirmation code in submission responses', () => {
  it.each(['opened', 'draft'])('is null while the submission is %s', async (state) => {
    const api = serviceWith(state);
    expect((await api.get(ctx, 's1'))?.confirmationCode).toBeNull();
    const list = await api.list(SCOPE, listQuery);
    expect(list.items[0].confirmationCode).toBeNull();
  });

  it('is returned once the submission is submitted', async () => {
    const api = serviceWith('submitted');
    expect((await api.get(ctx, 's1'))?.confirmationCode).toBe('K7M2Q9XA');
    const list = await api.list(SCOPE, listQuery);
    expect(list.items[0].confirmationCode).toBe('K7M2Q9XA');
  });
});
