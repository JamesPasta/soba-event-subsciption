import type { SubmitterReviewLabel } from '@soba/lib';
import type { SubmitterFormListRow } from '../../../../src/core/db/repos/submitterFormRepo';
import type { SubmitterSubmission } from '../../../../src/core/db/repos/submitterSubmissionRepo';

/**
 * What loadSubmitterSubmission stores for submission s1 on form f1. By default the caller owns a
 * draft on a members form whose roles let them submit and render.
 */
export const storedSubmission = (
  overrides: {
    role?: string | null;
    workflowState?: string;
    reviewStatus?: SubmitterReviewLabel | null;
    statusId?: string | null;
    form?: Partial<SubmitterFormListRow>;
  } = {},
): SubmitterSubmission => {
  const workflowState = overrides.workflowState ?? 'draft';
  return {
    submission: {
      id: 's1',
      workspaceId: 'ws1',
      formId: 'f1',
      form: { name: 'Permit application' },
      formVersionId: 'v1',
      formVersion: { versionNo: 3 },
      headRevisionId: 'r1',
      currentRevisionNo: 1,
      workflowState,
      engineSyncStatus: 'ready',
      submittedAt: null,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-02T00:00:00.000Z'),
      createdBy: 'Owner',
      submittedBy: 'u1',
      confirmationCode: 'K7M2Q9XA',
      engineSubmissionRef: 'engine-submission',
      engineSchemaRef: 'engine-form',
      formEngineCode: 'formio-v5',
      statusId: overrides.statusId ?? null,
    },
    access: {
      role: overrides.role === undefined ? 'owner' : overrides.role,
      workflowState,
      reviewStatus: overrides.reviewStatus ?? null,
    },
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
      ...overrides.form,
    },
  };
};
