import {
  SubmissionReviewStatuses,
  SubmissionWorkflowState,
  SubmitterReviewLabels,
} from '@soba/lib';
import { createSubmissionsApiService } from '../../../../src/core/api/submissions/serviceFactory';
import type { SubmissionService } from '../../../../src/core/services/submissionService';

const row = (
  id: string,
  workflowState: string,
  role = 'owner',
  reviewStatus: string | null = null,
) => ({
  id,
  formId: 'f1',
  formName: 'Form One',
  formVersionId: 'v1',
  workflowState,
  role,
  headRevisionId: 'r3',
  currentRevisionNo: 3,
  submittedAt: workflowState === 'draft' ? null : new Date('2026-01-02T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-03T00:00:00Z'),
  confirmationCode: 'K7M2Q9XA',
  reviewStatus,
});

// A forms row as the repo returns it; the response carries it through toSubmitterFormDto.
const form = {
  id: 'f1',
  name: 'Form One',
  workspaceId: 'w1',
  workspaceName: 'Roads',
  publishedVersionId: 'v1',
  permissions: ['submission_create'],
  audienceMode: 'members',
  audienceIdps: [],
  allowSubmitterDrafts: true,
};

const query = {
  offset: 10,
  limit: 5,
  workflowState: 'draft' as const,
  q: 'tax',
  sort: 'updatedAt:desc' as const,
  locale: 'fr' as const,
};

describe("listMine: the caller's own submissions", () => {
  it('reads as the caller with the declared query fields only', async () => {
    const listForParticipant = jest.fn().mockResolvedValue({ items: [], total: 0, forms: [] });
    const api = createSubmissionsApiService({ listForParticipant } as unknown as SubmissionService);

    await api.listMine('u1', { ...query, userId: 'someone-else' } as typeof query);

    expect(listForParticipant).toHaveBeenCalledWith({ userId: 'u1', ...query });
  });

  it('returns slim rows and their forms, with the code only once submitted, and echoes the query', async () => {
    const api = createSubmissionsApiService({
      listForParticipant: jest.fn().mockResolvedValue({
        items: [row('s1', 'draft'), row('s2', 'submitted', 'collaborator')],
        total: 12,
        forms: [form],
      }),
    } as unknown as SubmissionService);

    const result = await api.listMine('u1', query);

    expect(result.items).toEqual([
      {
        id: 's1',
        formId: 'f1',
        formName: 'Form One',
        formVersionId: 'v1',
        workflowState: 'draft',
        role: 'owner',
        headRevisionId: 'r3',
        currentRevisionNo: 3,
        submittedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        confirmationCode: null,
        reviewStatus: null,
      },
      expect.objectContaining({
        id: 's2',
        role: 'collaborator',
        submittedAt: '2026-01-02T00:00:00.000Z',
        confirmationCode: 'K7M2Q9XA',
      }),
    ]);
    expect(result.forms).toEqual([
      {
        id: 'f1',
        name: 'Form One',
        workspaceId: 'w1',
        workspaceName: 'Roads',
        publishedVersionId: 'v1',
        permissions: ['submission_create'],
        audienceMode: 'members',
        audienceIdps: [],
        allowSubmitterDrafts: true,
      },
    ]);
    expect(result.page).toEqual({ offset: 10, limit: 5, total: 12 });
    expect(result.filters).toEqual({ workflowState: 'draft', q: 'tax' });
    expect(result.sort).toBe('updatedAt:desc');
  });

  // The submitter is told the review in its own labels, never who it is assigned to.
  it.each([
    [
      SubmissionWorkflowState.submitted,
      SubmissionReviewStatuses.assigned,
      SubmitterReviewLabels.inReview,
    ],
    [
      SubmissionWorkflowState.revising,
      SubmissionReviewStatuses.revising,
      SubmitterReviewLabels.revisionRequested,
    ],
  ])('shows a %s submission at %s as %s, with its code', async (state, status, label) => {
    const api = createSubmissionsApiService({
      listForParticipant: jest.fn().mockResolvedValue({
        items: [row('s1', state, 'owner', status)],
        total: 1,
        forms: [form],
      }),
    } as unknown as SubmissionService);

    const [item] = (await api.listMine('u1', query)).items;

    expect(item).toMatchObject({ reviewStatus: label, confirmationCode: 'K7M2Q9XA' });
    expect(item).not.toHaveProperty('assignee');
  });
});
