import {
  DraftSaveStatus,
  Permissions,
  SubmissionChangeStatus,
  SubmissionParticipantRole,
  SubmissionWorkflowState,
  ApiErrorCodes,
  type SubmissionWorkflowStateCode,
  type ApiErrorCode,
} from './codes';
import {
  draftSaveStatusOf,
  formAccessAllows,
  isIdentifiedCaller,
  type AccessCaller,
  type FormAccessFacts,
  type SubmitterFormFacts,
} from './formAccess';
import { SubmitterReviewLabels, type SubmitterReviewLabel } from '../schemas/submissionReview';

/** A caller's standing on one submission, and the submission's state. */
export interface SubmissionAccessFacts {
  /** The caller's active participant role on the submission; null when they hold none. */
  role: string | null;
  workflowState: string;
}

/** A caller's standing on one submission, its state, and where its review stands. */
export interface SubmissionReviseFacts extends SubmissionAccessFacts {
  /** The review as its submitter is told it; null before it is submitted. */
  reviewStatus: SubmitterReviewLabel | null;
}

/** A submit-mode decision: allowed, or refused with its reason. */
export type SubmissionChange =
  | { status: typeof SubmissionChangeStatus.allowed }
  | {
      status: typeof SubmissionChangeStatus.denied | typeof SubmissionChangeStatus.closed;
      code: ApiErrorCode;
    };

const ALLOWED: SubmissionChange = { status: SubmissionChangeStatus.allowed };

const denied = (code: ApiErrorCode): SubmissionChange => ({
  status: SubmissionChangeStatus.denied,
  code,
});

const closed = (code: ApiErrorCode): SubmissionChange => ({
  status: SubmissionChangeStatus.closed,
  code,
});

const isAllowed = (change: SubmissionChange): boolean =>
  change.status === SubmissionChangeStatus.allowed;

/** The states before a submission is submitted; its owner can delete it in them. */
export const SUBMISSION_IN_PROGRESS_STATES: readonly SubmissionWorkflowStateCode[] = [
  SubmissionWorkflowState.opened,
  SubmissionWorkflowState.draft,
];

/** Whether the submission is in progress: not yet submitted. */
export const isSubmissionInProgress = (workflowState: string): boolean =>
  (SUBMISSION_IN_PROGRESS_STATES as readonly string[]).includes(workflowState);

/**
 * The states its submitters edit in: in progress, or sent back to them to revise. Continued rather
 * than viewed, and open to file uploads.
 */
export const SUBMISSION_EDITABLE_STATES: readonly SubmissionWorkflowStateCode[] = [
  ...SUBMISSION_IN_PROGRESS_STATES,
  SubmissionWorkflowState.revising,
];

/** The states a submission shows its confirmation code in: submitted, or sent back to revise. */
export const SUBMISSION_CONFIRMED_STATES: readonly SubmissionWorkflowStateCode[] = [
  SubmissionWorkflowState.submitted,
  SubmissionWorkflowState.revising,
];

/** Whether the submission's submitters can edit it: continued, not viewed. */
export const isSubmissionEditable = (workflowState: string): boolean =>
  (SUBMISSION_EDITABLE_STATES as readonly string[]).includes(workflowState);

/** Opening a new submission: the form's submit permission, then a published version. */
export const startStatusOf = (form: SubmitterFormFacts, caller: AccessCaller): SubmissionChange => {
  if (!formAccessAllows(form, caller, Permissions.submission_create)) {
    return denied(ApiErrorCodes.open_denied);
  }
  if (form.publishedVersionId === null) return closed(ApiErrorCodes.not_published);
  return ALLOWED;
};

/** Whether opening a new submission is allowed. */
export const canStartSubmission = (form: SubmitterFormFacts, caller: AccessCaller): boolean =>
  isAllowed(startStatusOf(form, caller));

/**
 * Reading a version's schema to start from: a caller who may start, then the published version. A
 * caller refused the start is refused before the version counts.
 */
export const versionSchemaStatusOf = (
  formVersionId: string,
  form: SubmitterFormFacts,
  caller: AccessCaller,
): SubmissionChange => {
  const start = startStatusOf(form, caller);
  if (!isAllowed(start)) return start;
  if (form.publishedVersionId !== formVersionId) {
    return closed(ApiErrorCodes.version_not_published);
  }
  return ALLOWED;
};

export const canReadVersionSchema = (
  formVersionId: string,
  form: SubmitterFormFacts,
  caller: AccessCaller,
): boolean => isAllowed(versionSchemaStatusOf(formVersionId, form, caller));

/** Whether a new submission on the form could save a draft. */
export const canSaveSubmissionDraft = (form: SubmitterFormFacts, caller: AccessCaller): boolean =>
  canStartSubmission(form, caller) && draftSaveStatusOf(form) === DraftSaveStatus.allowed;

/** Any active grant reads it. The public user holds the grant on every anonymous submission. */
export const canReadSubmission = (submission: SubmissionAccessFacts): boolean =>
  submission.role !== null;

/**
 * Save or submit: a grant and the form's submit permission. The submission's state and the form's
 * published version do not count.
 */
export const canWriteSubmission = (
  submission: SubmissionAccessFacts,
  form: FormAccessFacts,
  caller: AccessCaller,
): boolean =>
  canReadSubmission(submission) && formAccessAllows(form, caller, Permissions.submission_create);

/** Continued on the fill page rather than viewed: a write, while its submitters can edit it. */
export const canContinueSubmission = (
  submission: SubmissionAccessFacts,
  form: FormAccessFacts,
  caller: AccessCaller,
): boolean =>
  canWriteSubmission(submission, form, caller) && isSubmissionEditable(submission.workflowState);

/** A draft save: a write, then the form's drafts setting. */
export const saveDraftStatusOf = (
  submission: SubmissionAccessFacts,
  form: SubmitterFormFacts,
  caller: AccessCaller,
): SubmissionChange => {
  if (!canWriteSubmission(submission, form, caller)) return denied(ApiErrorCodes.write_denied);
  const drafts = draftSaveStatusOf(form);
  if (drafts === DraftSaveStatus.disabled) return denied(ApiErrorCodes.drafts_disabled);
  if (drafts === DraftSaveStatus.public) return denied(ApiErrorCodes.drafts_public);
  return ALLOWED;
};

export const canSaveDraftOnSubmission = (
  submission: SubmissionAccessFacts,
  form: SubmitterFormFacts,
  caller: AccessCaller,
): boolean => isAllowed(saveDraftStatusOf(submission, form, caller));

/** A file upload: a write, then the submission still editable by its submitters. */
export const uploadStatusOf = (
  submission: SubmissionAccessFacts,
  form: FormAccessFacts,
  caller: AccessCaller,
): SubmissionChange => {
  if (!canWriteSubmission(submission, form, caller)) return denied(ApiErrorCodes.write_denied);
  if (!isSubmissionEditable(submission.workflowState)) {
    return closed(ApiErrorCodes.upload_closed);
  }
  return ALLOWED;
};

export const canUploadSubmissionFile = (
  submission: SubmissionAccessFacts,
  form: FormAccessFacts,
  caller: AccessCaller,
): boolean => isAllowed(uploadStatusOf(submission, form, caller));

/**
 * A file delete: a write while its submitters can edit it; once submitted, only the form's update
 * permission; in any other state, no one. While revising, a file the answers from before it may hold
 * is only taken out of the answers, so ending the revision can restore it.
 */
export const canDeleteSubmissionFile = (
  submission: SubmissionAccessFacts,
  form: FormAccessFacts,
  caller: AccessCaller,
): boolean => {
  if (isSubmissionEditable(submission.workflowState)) {
    return canWriteSubmission(submission, form, caller);
  }
  return (
    submission.workflowState === SubmissionWorkflowState.submitted &&
    formAccessAllows(form, caller, Permissions.submission_update)
  );
};

/** A document render: a grant and the form's template read permission. */
export const canRenderSubmission = (
  submission: SubmissionAccessFacts,
  form: FormAccessFacts,
  caller: AccessCaller,
): boolean =>
  canReadSubmission(submission) &&
  formAccessAllows(form, caller, Permissions.document_template_read);

/** The caller deleting their own submission: the signed-in owner, then still in progress. */
export const ownDeleteStatusOf = (
  submission: SubmissionAccessFacts,
  caller: AccessCaller,
): SubmissionChange => {
  if (!isIdentifiedCaller(caller) || submission.role !== SubmissionParticipantRole.owner) {
    return denied(ApiErrorCodes.delete_denied);
  }
  if (!isSubmissionInProgress(submission.workflowState)) {
    return closed(ApiErrorCodes.delete_closed);
  }
  return ALLOWED;
};

export const canDeleteOwnSubmission = (
  submission: SubmissionAccessFacts,
  caller: AccessCaller,
): boolean => isAllowed(ownDeleteStatusOf(submission, caller));

/**
 * The owner revising their own submission: a signed-in owner who may still write it, on a form
 * whose review settings let submitters revise, while it is submitted and no reviewer has taken it
 * up. A revision sends it back to its submitters, as a reviewer's request does.
 */
export const reviseStatusOf = (
  submission: SubmissionReviseFacts,
  form: SubmitterFormFacts,
  caller: AccessCaller,
): SubmissionChange => {
  if (
    !isIdentifiedCaller(caller) ||
    submission.role !== SubmissionParticipantRole.owner ||
    !canWriteSubmission(submission, form, caller)
  ) {
    return denied(ApiErrorCodes.revise_denied);
  }
  if (!form.allowSubmitterRevision) return denied(ApiErrorCodes.revise_disabled);
  if (
    submission.workflowState !== SubmissionWorkflowState.submitted ||
    submission.reviewStatus !== SubmitterReviewLabels.submitted
  ) {
    return closed(ApiErrorCodes.revise_closed);
  }
  return ALLOWED;
};

export const canReviseSubmission = (
  submission: SubmissionReviseFacts,
  form: SubmitterFormFacts,
  caller: AccessCaller,
): boolean => isAllowed(reviseStatusOf(submission, form, caller));
