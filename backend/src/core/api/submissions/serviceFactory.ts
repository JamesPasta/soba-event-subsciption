import { SubmissionService, type SubmissionContentRefs } from '../../services/submissionService';
import type { WriteLanding } from '../../services/submissionWriteGate';
import type { FormAccessGrant } from '../../db/repos/formAccessRepo';
import { toSubmitterFormDto } from '../forms/serviceFactory';
import type {
  ParticipantSubmissionListRow,
  StaffSubmissionListRow,
  SubmissionDetailRow,
} from '../../db/repos/submissionRepo';
import { reviewUserOf } from '../../db/repos/submissionReviewRepo';
import { findEffectiveReviewSettingsOfForm } from '../../../features/form-settings/review/repo';
import {
  SUBMISSION_CONFIRMED_STATES,
  submitterReviewLabelOf,
  type ListMySubmissionsResponse,
  type MySubmissionRole,
  type MySubmissionState,
  type OpenSubmissionBody,
  type SubmissionDataBody,
  type SortLocale,
  type SubmissionListSort,
  type SubmissionReviewStatus,
  type StaffSubmissionListSort,
  type SubmitSubmissionBody,
} from '@soba/lib';

export interface SubmissionsContextInput {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
}

/** Scope for list/search: the workspaces searched and the access grant rows must pass. */
export interface SubmissionsListScopeInput {
  workspaceIds: string[];
  actorId: string;
  formAccess: FormAccessGrant;
}

export interface ListSubmissionsQueryInput {
  workspaceId?: string;
  formId?: string;
  formVersionId?: string;
  submissionId?: string;
  offset: number;
  limit: number;
  workflowState?: string;
  reviewStatus?: SubmissionReviewStatus;
  assigneeId?: string;
  createdBy?: string;
  q?: string;
  sort: StaffSubmissionListSort;
  locale: SortLocale;
}

export interface ListMySubmissionsQueryInput {
  offset: number;
  limit: number;
  workflowState?: MySubmissionState;
  q?: string;
  sort: SubmissionListSort;
  locale: SortLocale;
}

// The code exists from open but is shown only once the submission is confirmed.
const confirmationCodeOf = (item: { workflowState: string; confirmationCode: string }) =>
  (SUBMISSION_CONFIRMED_STATES as readonly string[]).includes(item.workflowState)
    ? item.confirmationCode
    : null;

export const toSubmissionDto = (item: SubmissionDetailRow) => ({
  id: item.id,
  formId: item.formId,
  formName: item.form.name ?? 'Untitled Form',
  formVersionId: item.formVersionId,
  versionNo: item.formVersion.versionNo ?? 1,
  workflowState: item.workflowState,
  engineSyncStatus: item.engineSyncStatus,
  currentRevisionNo: item.currentRevisionNo,
  headRevisionId: item.headRevisionId,
  submittedAt: item.submittedAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  createdBy: item.createdBy,
  submittedBy: item.submittedBy,
  confirmationCode: confirmationCodeOf(item),
});

export const toSubmissionWriteDto = (outcome: {
  record: SubmissionDetailRow;
  revision: WriteLanding;
}) => ({
  ...toSubmissionDto(outcome.record),
  revision: outcome.revision,
});

const toSubmissionListItemDto = (item: StaffSubmissionListRow) => ({
  id: item.id,
  formId: item.formId,
  formName: item.form.name ?? 'Untitled Form',
  formVersionId: item.formVersionId,
  versionNo: item.formVersion.versionNo ?? 1,
  workflowState: item.workflowState,
  engineSyncStatus: item.engineSyncStatus,
  submittedAt: item.submittedAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  createdBy: item.createdBy,
  submittedBy: item.submittedBy,
  confirmationCode: confirmationCodeOf(item),
  reviewStatus: item.reviewStatus as SubmissionReviewStatus | null,
  assignee: item.assignee
    ? reviewUserOf(item.assignee.id, item.assignee.profile, item.assignee.label)
    : null,
});

const toMySubmissionListItemDto = (item: ParticipantSubmissionListRow) => ({
  id: item.id,
  formId: item.formId,
  formName: item.formName,
  formVersionId: item.formVersionId,
  workflowState: item.workflowState as MySubmissionState,
  role: item.role as MySubmissionRole,
  headRevisionId: item.headRevisionId,
  currentRevisionNo: item.currentRevisionNo,
  submittedAt: item.submittedAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  confirmationCode: confirmationCodeOf(item),
  reviewStatus: submitterReviewLabelOf(item.reviewStatus as SubmissionReviewStatus | null),
});

export function createSubmissionsApiService(submissionService: SubmissionService) {
  return {
    get: async (ctx: SubmissionsContextInput, submissionId: string) => {
      const row = await submissionService.get(ctx.workspaceId, submissionId);
      return row ? toSubmissionDto(row) : null;
    },

    getData: (ctx: SubmissionsContextInput, submissionId: string) =>
      submissionService.getContent({ workspaceId: ctx.workspaceId, submissionId }),

    readContent: (refs: SubmissionContentRefs) => submissionService.readContent(refs),

    list: async (scope: SubmissionsListScopeInput, query: ListSubmissionsQueryInput) => {
      // One form's review settings decide its list: with status changes on, it holds the submissions
      // in review and shows their status and assignee.
      const review = query.formId ? await findEffectiveReviewSettingsOfForm(query.formId) : null;
      const result = await submissionService.list({
        inReviewOnly: review?.allowStatusUpdates === true,
        workspaceIds: scope.workspaceIds,
        actorId: scope.actorId,
        formAccess: scope.formAccess,
        offset: query.offset,
        limit: query.limit,
        formId: query.formId,
        formVersionId: query.formVersionId,
        submissionId: query.submissionId,
        workflowState: query.workflowState,
        reviewStatus: query.reviewStatus,
        assigneeId: query.assigneeId,
        createdBy: query.createdBy,
        q: query.q,
        sort: query.sort,
        locale: query.locale,
      });

      return {
        items: result.items.map((item) => toSubmissionListItemDto(item)),
        page: {
          offset: query.offset,
          limit: query.limit,
          total: result.total,
        },
        filters: {
          workspaceId: query.workspaceId,
          formId: query.formId,
          formVersionId: query.formVersionId,
          submissionId: query.submissionId,
          workflowState: query.workflowState,
          reviewStatus: query.reviewStatus,
          assigneeId: query.assigneeId,
          createdBy: query.createdBy,
          q: query.q,
        },
        sort: query.sort,
        ...(review ? { allowStatusUpdates: review.allowStatusUpdates } : {}),
      };
    },

    listMine: async (
      userId: string,
      query: ListMySubmissionsQueryInput,
    ): Promise<ListMySubmissionsResponse> => {
      const result = await submissionService.listForParticipant({
        userId,
        offset: query.offset,
        limit: query.limit,
        workflowState: query.workflowState,
        q: query.q,
        sort: query.sort,
        locale: query.locale,
      });
      return {
        items: result.items.map((item) => toMySubmissionListItemDto(item)),
        forms: result.forms.map(toSubmitterFormDto),
        page: { offset: query.offset, limit: query.limit, total: result.total },
        filters: { workflowState: query.workflowState, q: query.q },
        sort: query.sort,
      };
    },

    open: async (ctx: SubmissionsContextInput, body: OpenSubmissionBody) => {
      const { created, record } = await submissionService.open({ ...ctx, ...body });
      return { created, submission: toSubmissionDto(record) };
    },

    save: (ctx: SubmissionsContextInput, submissionId: string, body: SubmissionDataBody) =>
      submissionService
        .save({ ...ctx, submissionId, ...body })
        .then((outcome) => toSubmissionWriteDto(outcome)),

    submit: (ctx: SubmissionsContextInput, submissionId: string, body: SubmitSubmissionBody) =>
      submissionService
        .submit({ ...ctx, submissionId, ...body })
        .then((outcome) => toSubmissionWriteDto(outcome)),

    /** Staff change a submitted submission's answers; answers with the submission after it. */
    editData: (ctx: SubmissionsContextInput, submissionId: string, body: SubmissionDataBody) =>
      submissionService.editAsStaff({ ...ctx, submissionId, ...body }).then(toSubmissionDto),

    delete: (ctx: SubmissionsContextInput, submissionId: string) =>
      submissionService.delete({ ...ctx, submissionId }),

    deleteUnsubmitted: (ctx: SubmissionsContextInput, submissionId: string) =>
      submissionService.deleteUnsubmitted({ ...ctx, submissionId }),
  };
}

export type SubmissionsApiService = ReturnType<typeof createSubmissionsApiService>;
