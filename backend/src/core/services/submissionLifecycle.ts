import {
  SubmissionEventType,
  SubmissionWorkflowState,
  type SubmissionWriteEventCode,
  type SubmissionWorkflowStateCode,
} from '../db/codes';
import { ConflictError } from '../errors';

/**
 * In-process submission lifecycle policy: given the submission's current state and the operation
 * performed, decide the resulting state and reject illegal transitions.
 *
 * This is a deliberate seam. When the workflow engine (Temporal) lands, the transition decision moves
 * there and this module retires; keeping it pure (no I/O, no db) makes that port mechanical. Callers
 * pass the current state read from the row and the event they are recording — nothing here reads or
 * writes state itself.
 *
 * Flow: opened --saved--> draft --saved--> draft --submitted--> submitted.
 * A reviewer sends a submitted submission back to revise (submitted -> revising); a save keeps it
 * revising, and a resubmit returns it to submitted. Reviewers move it in and out of revising
 * (submissionReviewRepo); it never passes through here.
 * Terminal states (submitted, deleted) accept no further edits or submits. Staff delete from any live
 * state; a submitter deletes only from SUBMISSION_IN_PROGRESS_STATES (@soba/lib). Neither passes
 * through resolveSubmissionTransition.
 */

const TERMINAL_STATES: ReadonlySet<string> = new Set([
  SubmissionWorkflowState.submitted,
  SubmissionWorkflowState.deleted,
]);

/** A terminal submission accepts no new current version; a write against it is held as pending. */
export const isTerminalSubmissionState = (state: string): boolean => TERMINAL_STATES.has(state);

/** The state each recordable event drives a non-terminal submission into. */
const TARGET_STATE: Record<SubmissionWriteEventCode, SubmissionWorkflowStateCode> = {
  [SubmissionEventType.saved]: SubmissionWorkflowState.draft,
  [SubmissionEventType.submitted]: SubmissionWorkflowState.submitted,
};

/** A save while revising keeps it revising; it never falls back to a draft. */
const targetStateOf = (
  current: string,
  event: SubmissionWriteEventCode,
): SubmissionWorkflowStateCode =>
  current === SubmissionWorkflowState.revising && event === SubmissionEventType.saved
    ? SubmissionWorkflowState.revising
    : TARGET_STATE[event];

/**
 * Resolve the workflow state a `saved`/`submitted` event moves the submission into. Throws
 * ConflictError (409) when the submission is already terminal, so an expected denial never surfaces
 * as a 500.
 */
export const resolveSubmissionTransition = (
  current: string,
  event: SubmissionWriteEventCode,
): SubmissionWorkflowStateCode => {
  if (TERMINAL_STATES.has(current)) {
    throw new ConflictError(`Submission is ${current} and can no longer be changed`);
  }
  return targetStateOf(current, event);
};
