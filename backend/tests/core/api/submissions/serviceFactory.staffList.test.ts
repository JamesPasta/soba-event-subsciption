const mockFindReview = jest.fn();
jest.mock('../../../../src/features/form-settings/review/repo', () => ({
  findEffectiveReviewSettingsOfForm: (...args: unknown[]) => mockFindReview(...args),
}));

import { SubmissionReviewStatuses, SubmissionWorkflowState } from '@soba/lib';
import { createSubmissionsApiService } from '../../../../src/core/api/submissions/serviceFactory';
import type { SubmissionService } from '../../../../src/core/services/submissionService';

const row = {
  id: 's1',
  formId: 'f1',
  form: { name: 'Permit' },
  formVersionId: 'v1',
  formVersion: { versionNo: 2 },
  workflowState: SubmissionWorkflowState.submitted,
  engineSyncStatus: 'ready',
  submittedAt: new Date('2026-10-02T00:00:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-03T00:00:00Z'),
  createdBy: 'Sub Mitter',
  submittedBy: 'u-sub',
  confirmationCode: 'K7M2Q9XA',
  reviewStatus: SubmissionReviewStatuses.assigned,
  assignee: {
    id: 'u-rev',
    profile: { name: 'Grace Hopper', email: 'grace@example.com' },
    label: 'Grace',
  },
};
const scope = { workspaceIds: ['ws1'], actorId: 'a1', formAccess: { kind: 'all' } };
const query = {
  formId: 'f1',
  offset: 0,
  limit: 10,
  reviewStatus: SubmissionReviewStatuses.assigned,
  assigneeId: '01a1891a-3246-773c-a7ec-39fca5fea6c2',
  sort: 'assignee:asc' as const,
  locale: 'en' as const,
};

let list: jest.Mock;
let api: ReturnType<typeof createSubmissionsApiService>;

beforeEach(() => {
  jest.clearAllMocks();
  list = jest.fn().mockResolvedValue({ items: [row], total: 1 });
  api = createSubmissionsApiService({ list } as unknown as SubmissionService);
  mockFindReview.mockResolvedValue({ allowStatusUpdates: true, allowSubmitterRevision: false });
});

it('lists each row with its review status and assignee', async () => {
  const result = await api.list(scope as never, query);

  expect(result.items[0]).toMatchObject({
    reviewStatus: SubmissionReviewStatuses.assigned,
    assignee: { id: 'u-rev', email: 'grace@example.com' },
  });
});

it('filters and sorts by the review, and echoes the filters', async () => {
  const result = await api.list(scope as never, query);

  expect(list).toHaveBeenCalledWith(
    expect.objectContaining({
      reviewStatus: SubmissionReviewStatuses.assigned,
      assigneeId: query.assigneeId,
      sort: 'assignee:asc',
    }),
  );
  expect(result.filters).toMatchObject({
    reviewStatus: SubmissionReviewStatuses.assigned,
    assigneeId: query.assigneeId,
  });
});

it("says whether one form's review shows", async () => {
  mockFindReview.mockResolvedValue({ allowStatusUpdates: false, allowSubmitterRevision: false });

  const result = await api.list(scope as never, query);

  expect(mockFindReview).toHaveBeenCalledWith('f1');
  expect(result.allowStatusUpdates).toBe(false);
});

it('says nothing of the review for a list across forms', async () => {
  const result = await api.list(scope as never, { ...query, formId: undefined });

  expect(mockFindReview).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty('allowStatusUpdates');
});

it("lists only the submissions in review when the form's status updates are on", async () => {
  await api.list(scope as never, query);

  expect(list).toHaveBeenCalledWith(expect.objectContaining({ inReviewOnly: true }));
});

it('lists every real submission when status updates are off, or across forms', async () => {
  mockFindReview.mockResolvedValue({ allowStatusUpdates: false, allowSubmitterRevision: false });
  await api.list(scope as never, query);
  await api.list(scope as never, { ...query, formId: undefined });

  expect(list).toHaveBeenCalledTimes(2);
  for (const [input] of list.mock.calls) expect(input.inReviewOnly).toBe(false);
});

it('lists an unsubmitted row with no review', async () => {
  mockFindReview.mockResolvedValue({ allowStatusUpdates: false, allowSubmitterRevision: false });
  list.mockResolvedValue({
    items: [
      {
        ...row,
        workflowState: SubmissionWorkflowState.draft,
        reviewStatus: null,
        assignee: null,
      },
    ],
    total: 1,
  });

  const [item] = (await api.list(scope as never, query)).items;

  expect(item).toMatchObject({ reviewStatus: null, assignee: null, confirmationCode: null });
});
