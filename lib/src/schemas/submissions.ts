import { z } from 'zod';
import { OffsetPageSchema, makeSortEnum } from './pagination';
import { STAFF_SUBMISSION_SORT_FIELDS, SUBMISSION_SORT_FIELDS } from '../sort';
import { SubmissionParticipantRole, SubmissionWorkflowState } from '../permissions/codes';
import { SubmitterFormSchema } from './forms';
import {
  SubmissionReviewStatusSchema,
  SubmissionReviewUserSchema,
  SubmitterReviewLabelSchema,
} from './submissionReview';

// Ids are lower-cased as Postgres stores them, so a retry spelled in another case still matches.
export const OpenSubmissionBodySchema = z.object({
  // v7 only: the client mints this id, and it is the submission's identity.
  id: z.uuidv7().toLowerCase(),
  formId: z.string().min(1).toLowerCase(),
  // Must be the form's published version when given.
  formVersionId: z.uuid().toLowerCase().optional(),
});

export const SubmissionDataBodySchema = z.object({
  data: z.record(z.string(), z.unknown()),
  // Client-minted id for the revision this write creates. A retry reuses it.
  revisionId: z.uuidv7(),
  // The head revision the client loaded. A write whose base is no longer the head is kept as a
  // pending revision (200, `revision.status` pending), not applied.
  baseRevisionId: z.uuid(),
});

// Same body as save.
export const SubmitSubmissionBodySchema = SubmissionDataBodySchema;

export const SubmissionListItemSchema = z.object({
  id: z.string(),
  formId: z.string(),
  formName: z.string().optional(),
  formVersionId: z.string(),
  versionNo: z.number().int().optional(),
  workflowState: z.string(),
  engineSyncStatus: z.string(),
  submittedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().nullable().optional(),
  submittedBy: z.string().nullable().optional(),
  // Null until the submission is submitted.
  confirmationCode: z.string().nullable(),
  // Staff list only: the review status and who it is assigned to; null until it is submitted.
  reviewStatus: SubmissionReviewStatusSchema.nullable().optional(),
  assignee: SubmissionReviewUserSchema.nullable().optional(),
});

export const SubmissionResponseSchema = z.object({
  id: z.string(),
  formId: z.string(),
  formName: z.string(),
  formVersionId: z.string(),
  versionNo: z.number().int(),
  workflowState: z.string(),
  engineSyncStatus: z.string(),
  currentRevisionNo: z.number().int(),
  headRevisionId: z.string().nullable(),
  submittedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().nullable().optional(),
  submittedBy: z.string().nullable().optional(),
  // Null until the submission is submitted.
  confirmationCode: z.string().nullable(),
});

/** Where a save/submit landed: `current` applied it as the live version, `pending` held it for review. */
export const SubmissionRevisionInfoSchema = z.object({
  id: z.string(),
  revisionNo: z.number().int(),
  status: z.string(),
  reason: z.string(),
});

/** Save/submit response: the submission plus the revision this write produced. */
export const SubmissionWriteResponseSchema = SubmissionResponseSchema.extend({
  revision: SubmissionRevisionInfoSchema,
});

/**
 * A submission as its submitter reads it: its review as they are told it, and whether they can
 * continue it on the fill page.
 */
export const SubmitSubmissionResponseSchema = SubmissionResponseSchema.extend({
  reviewLabel: SubmitterReviewLabelSchema.nullable(),
  canContinue: z.boolean(),
});

export type SubmissionRevisionInfo = z.infer<typeof SubmissionRevisionInfoSchema>;
export type SubmissionWriteResponse = z.infer<typeof SubmissionWriteResponseSchema>;

export type OpenSubmissionBody = z.infer<typeof OpenSubmissionBodySchema>;
export type SubmissionDataBody = z.infer<typeof SubmissionDataBodySchema>;
export type SubmitSubmissionBody = z.infer<typeof SubmitSubmissionBodySchema>;
export type SubmissionListItem = z.infer<typeof SubmissionListItemSchema>;
export type SubmissionResponse = z.infer<typeof SubmissionResponseSchema>;
export type SubmitSubmissionResponse = z.infer<typeof SubmitSubmissionResponseSchema>;

export const SubmissionSortSchema = makeSortEnum(SUBMISSION_SORT_FIELDS);
export type SubmissionListSort = z.infer<typeof SubmissionSortSchema>;

export const StaffSubmissionSortSchema = makeSortEnum(STAFF_SUBMISSION_SORT_FIELDS);
export type StaffSubmissionListSort = z.infer<typeof StaffSubmissionSortSchema>;

export const ListSubmissionsResponseSchema = z.object({
  items: z.array(SubmissionListItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    workspaceId: z.string().optional(),
    formId: z.string().optional(),
    formVersionId: z.string().optional(),
    submissionId: z.string().optional(),
    workflowState: z.string().optional(),
    reviewStatus: SubmissionReviewStatusSchema.optional(),
    assigneeId: z.string().optional(),
    createdBy: z.string().optional(),
    q: z.string().optional(),
  }),
  sort: StaffSubmissionSortSchema,
  // When the list is of one form: whether its review settings let reviewers change the status. The
  // status and assignee columns show only then.
  allowStatusUpdates: z.boolean().optional(),
});

export type ListSubmissionsResponse = z.infer<typeof ListSubmissionsResponseSchema>;

/** The states the caller's own list shows; an opened submission holds no answers yet. */
export const MY_SUBMISSION_STATES = [
  SubmissionWorkflowState.draft,
  SubmissionWorkflowState.submitted,
  SubmissionWorkflowState.revising,
] as const;
export const MySubmissionStateSchema = z.enum(MY_SUBMISSION_STATES);
export type MySubmissionState = z.infer<typeof MySubmissionStateSchema>;

/** The caller's grant on a submission; only an owner deletes. */
export const MySubmissionRoleSchema = z.enum([
  SubmissionParticipantRole.owner,
  SubmissionParticipantRole.collaborator,
]);
export type MySubmissionRole = z.infer<typeof MySubmissionRoleSchema>;

/** A row of the caller's own submissions. */
export const MySubmissionListItemSchema = z.object({
  id: z.string(),
  formId: z.string(),
  formName: z.string(),
  formVersionId: z.string(),
  workflowState: MySubmissionStateSchema,
  role: MySubmissionRoleSchema,
  // The revision the next write is based on, and its number in append order over every revision.
  headRevisionId: z.string().nullable(),
  currentRevisionNo: z.number().int(),
  submittedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Null until the submission is submitted.
  confirmationCode: z.string().nullable(),
  // Where its review stands, as the submitter is told it; null until it is submitted.
  reviewStatus: SubmitterReviewLabelSchema.nullable(),
});

export const ListMySubmissionsResponseSchema = z.object({
  items: z.array(MySubmissionListItemSchema),
  // The forms of the page's rows, once each, with their facts for the caller.
  forms: z.array(SubmitterFormSchema),
  page: OffsetPageSchema,
  filters: z.object({
    workflowState: MySubmissionStateSchema.optional(),
    q: z.string().optional(),
  }),
  sort: SubmissionSortSchema,
});

export type MySubmissionListItem = z.infer<typeof MySubmissionListItemSchema>;
export type ListMySubmissionsResponse = z.infer<typeof ListMySubmissionsResponseSchema>;
