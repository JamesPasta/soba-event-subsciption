import { z } from 'zod';

/** A submission's review status codes; refer to a status through these, never by its string. */
export const SubmissionReviewStatuses = {
  submitted: 'SUBMITTED',
  assigned: 'ASSIGNED',
  revising: 'REVISING',
  completed: 'COMPLETED',
} as const;

export const SUBMISSION_REVIEW_STATUSES = [
  SubmissionReviewStatuses.submitted,
  SubmissionReviewStatuses.assigned,
  SubmissionReviewStatuses.revising,
  SubmissionReviewStatuses.completed,
] as const;
export const SubmissionReviewStatusSchema = z.enum(SUBMISSION_REVIEW_STATUSES);
export type SubmissionReviewStatus = z.infer<typeof SubmissionReviewStatusSchema>;

/**
 * The review's sub-resources, under `/design/submissions/{id}/review`. The backend mounts them and
 * the frontend calls them by these names.
 */
export const SubmissionReviewSubpaths = {
  notes: '/notes',
  status: '/status',
  reviewers: '/reviewers',
} as const;

/**
 * A submission's answers, under `/design/submissions/{id}`: staff read them, and change them once
 * submitted.
 */
export const SUBMISSION_DATA_SUBPATH = '/data';

/** The longest note a reviewer can add, in characters. */
export const SUBMISSION_NOTE_MAX_LENGTH = 4000;

/** A person on a review record: who it is assigned to, or who can be. */
export const SubmissionReviewUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
});
export type SubmissionReviewUser = z.infer<typeof SubmissionReviewUserSchema>;

export const SubmissionStatusChangeSchema = z.object({
  id: z.string(),
  status: SubmissionReviewStatusSchema,
  assignee: SubmissionReviewUserSchema.nullable(),
  changedAt: z.string(),
  updatedBy: z.string(),
});
export type SubmissionStatusChange = z.infer<typeof SubmissionStatusChangeSchema>;

export const SubmissionNoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type SubmissionNote = z.infer<typeof SubmissionNoteSchema>;

export const SubmissionEditSchema = z.object({
  id: z.string(),
  editedAt: z.string(),
  editedBy: z.string(),
});
export type SubmissionEdit = z.infer<typeof SubmissionEditSchema>;

/**
 * Newest first throughout. The current status and assignee are `statusHistory[0]`; a submission
 * that was never submitted has no status yet, so its history is empty.
 */
export const SubmissionReviewSchema = z.object({
  /** Whether the form's review settings let reviewers change the status. */
  allowStatusUpdates: z.boolean(),
  statusHistory: z.array(SubmissionStatusChangeSchema),
  notes: z.array(SubmissionNoteSchema),
  editHistory: z.array(SubmissionEditSchema),
});
export type SubmissionReview = z.infer<typeof SubmissionReviewSchema>;

/**
 * A note to add. `id` is chosen by the client (a UUID), so a retry of the same note writes it once;
 * the same id with different text is refused.
 */
export const AddSubmissionNoteBodySchema = z.object({
  id: z.uuid(),
  text: z.string().trim().min(1).max(SUBMISSION_NOTE_MAX_LENGTH),
});
export type AddSubmissionNoteBody = z.infer<typeof AddSubmissionNoteBodySchema>;

/**
 * Where a reviewer may move a submission from each status; the server and the status panel both
 * use it, as CHEFS v1 did. Assigned can move to Assigned, to hand the submission to someone else.
 * Revising asks the submitter to revise; moving on from it ends the revision and restores the
 * answers from before it. The submitter's resubmit moves Revising to Submitted, which is not a
 * reviewer move.
 */
export const SUBMISSION_STATUS_MOVES: Readonly<
  Record<SubmissionReviewStatus, readonly SubmissionReviewStatus[]>
> = {
  [SubmissionReviewStatuses.submitted]: [
    SubmissionReviewStatuses.assigned,
    SubmissionReviewStatuses.completed,
    SubmissionReviewStatuses.revising,
  ],
  [SubmissionReviewStatuses.assigned]: [
    SubmissionReviewStatuses.assigned,
    SubmissionReviewStatuses.completed,
    SubmissionReviewStatuses.revising,
  ],
  [SubmissionReviewStatuses.completed]: [
    SubmissionReviewStatuses.assigned,
    SubmissionReviewStatuses.revising,
  ],
  [SubmissionReviewStatuses.revising]: [
    SubmissionReviewStatuses.assigned,
    SubmissionReviewStatuses.completed,
  ],
};

/** The statuses a reviewer may move a submission to; none before it is submitted. */
export const nextSubmissionStatuses = (
  current: SubmissionReviewStatus | undefined,
): readonly SubmissionReviewStatus[] => (current ? SUBMISSION_STATUS_MOVES[current] : []);

/**
 * Whether a reviewer can change the status: when the form's review settings allow it, and always
 * while it is Revising, so a revision can be ended whatever the settings became.
 */
export const canChangeReviewStatus = (
  allowStatusUpdates: boolean,
  current: SubmissionReviewStatus | undefined,
): boolean => allowStatusUpdates || current === SubmissionReviewStatuses.revising;

/**
 * A status change. `id` is chosen by the client (a UUID), so a retry writes it once.
 * `fromStatusId` is the current status the reviewer saw; when the status has moved on since, the
 * change is refused. Assigned names who it is assigned to; no other status takes an assignee.
 * A `comment` is saved as a staff note with the change, and goes in its email only when
 * `attachCommentToEmail` asks for it.
 */
export const UpdateSubmissionStatusBodySchema = z
  .object({
    id: z.uuid(),
    fromStatusId: z.uuid(),
    status: SubmissionReviewStatusSchema,
    assigneeId: z.uuid().nullable(),
    comment: z.string().trim().max(SUBMISSION_NOTE_MAX_LENGTH).optional(),
    attachCommentToEmail: z.boolean().optional(),
  })
  .refine(
    (body) => (body.status === SubmissionReviewStatuses.assigned) === (body.assigneeId !== null),
    {
      message: 'Assigned takes an assignee; no other status does',
      path: ['assigneeId'],
    },
  )
  .refine((body) => !body.attachCommentToEmail || !!body.comment, {
    message: 'Only a comment can be attached to the email',
    path: ['attachCommentToEmail'],
  });
export type UpdateSubmissionStatusBody = z.infer<typeof UpdateSubmissionStatusBodySchema>;

/**
 * The owner sending their own submission back to revise. `id` is the status change's, chosen by the
 * client (a UUID), so a retry writes it once.
 */
export const ReviseSubmissionBodySchema = z.object({ id: z.uuid() });
export type ReviseSubmissionBody = z.infer<typeof ReviseSubmissionBodySchema>;

/** Who a submission can be assigned to: everyone holding submission_review on its form. */
export const SubmissionReviewersSchema = z.object({
  items: z.array(SubmissionReviewUserSchema),
});
export type SubmissionReviewers = z.infer<typeof SubmissionReviewersSchema>;

/**
 * What a submitter is told of the review. It never says who the submission is assigned to, so
 * Assigned reads as in review.
 */
export const SubmitterReviewLabels = {
  submitted: 'submitted',
  inReview: 'inReview',
  completed: 'completed',
  revisionRequested: 'revisionRequested',
} as const;
export const SUBMITTER_REVIEW_LABELS = [
  SubmitterReviewLabels.submitted,
  SubmitterReviewLabels.inReview,
  SubmitterReviewLabels.completed,
  SubmitterReviewLabels.revisionRequested,
] as const;
export const SubmitterReviewLabelSchema = z.enum(SUBMITTER_REVIEW_LABELS);
export type SubmitterReviewLabel = z.infer<typeof SubmitterReviewLabelSchema>;

const SUBMITTER_LABEL_OF: Readonly<Record<SubmissionReviewStatus, SubmitterReviewLabel>> = {
  [SubmissionReviewStatuses.submitted]: SubmitterReviewLabels.submitted,
  [SubmissionReviewStatuses.assigned]: SubmitterReviewLabels.inReview,
  [SubmissionReviewStatuses.completed]: SubmitterReviewLabels.completed,
  [SubmissionReviewStatuses.revising]: SubmitterReviewLabels.revisionRequested,
};

/** The label a submitter sees for a review status; none before the submission is submitted. */
export const submitterReviewLabelOf = (
  status: SubmissionReviewStatus | null | undefined,
): SubmitterReviewLabel | null => (status ? SUBMITTER_LABEL_OF[status] : null);
