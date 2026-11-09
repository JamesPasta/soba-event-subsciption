import {
  RevisionReason,
  RevisionStatus,
  type RevisionReasonCode,
  type RevisionStatusCode,
  type SubmissionWriteEventCode,
  type SubmissionWorkflowStateCode,
} from '../db/codes';
import { ApiErrorCodes } from '@soba/lib';
import { ConflictError } from '../errors';
import { isTerminalSubmissionState, resolveSubmissionTransition } from './submissionLifecycle';

/** A revision already recorded under a write's revision id. */
export interface RecordedRevision {
  submissionId: string;
  eventType: string;
  changedBy: string | null;
  revisionNo: number;
  status: string;
  reason: string;
}

/** Where a write landed: `current` applied it, `pending` held it for review. */
export interface WriteLanding {
  id: string;
  revisionNo: number;
  status: RevisionStatusCode;
  reason: RevisionReasonCode;
}

export type RecordedWriteDecision = { kind: 'new' } | { kind: 'replay'; revision: WriteLanding };

/**
 * Where a recorded write replays: where it first landed. A revision that landed as current and was
 * later superseded replays as `current`; the response's head shows it is no longer the head.
 */
export const replayedLanding = (
  revisionId: string,
  recorded: { revisionNo: number; status: string; reason: string },
): WriteLanding => {
  const landedPending = recorded.status === RevisionStatus.pending;
  return {
    id: revisionId,
    revisionNo: recorded.revisionNo,
    status: landedPending ? RevisionStatus.pending : RevisionStatus.current,
    reason: landedPending ? (recorded.reason as RevisionReasonCode) : RevisionReason.accepted,
  };
};

/**
 * Whether a save/submit was already recorded under its revision id. The caller's own write of the
 * same event on the same submission replays where it first landed. Any other write under the id, or
 * a revision id equal to its own base, is a ConflictError.
 */
export const decideRecordedWrite = (request: {
  submissionId: string;
  eventType: SubmissionWriteEventCode;
  actorId: string;
  revisionId: string;
  baseRevisionId: string;
  recorded: RecordedRevision | null;
}): RecordedWriteDecision => {
  const { recorded } = request;
  if (request.revisionId === request.baseRevisionId) {
    throw new ConflictError(
      'Revision id already used by another write',
      ApiErrorCodes.revision_id_taken,
    );
  }
  if (!recorded) return { kind: 'new' };
  if (
    recorded.submissionId !== request.submissionId ||
    recorded.eventType !== request.eventType ||
    recorded.changedBy !== request.actorId
  ) {
    throw new ConflictError(
      'Revision id already used by another write',
      ApiErrorCodes.revision_id_taken,
    );
  }
  return { kind: 'replay', revision: replayedLanding(request.revisionId, recorded) };
};

/**
 * Whether an open of a taken id asks for what the id holds: the same form, and the same version when
 * the open names one. Only the opener's own live submission can be that retry.
 */
export const opensSameSubmission = (
  held: { formId: string; formVersionId: string },
  open: { formId: string; formVersionId?: string },
): boolean =>
  held.formId === open.formId && (!open.formVersionId || open.formVersionId === held.formVersionId);

export interface SubmissionWriteRequest {
  submission: { id: string; workflowState: string; headRevisionId: string | null };
  eventType: SubmissionWriteEventCode;
  /** Head the client loaded. */
  baseRevisionId: string;
}

export type SubmissionWriteDecision =
  | {
      kind: 'current';
      workflowState: SubmissionWorkflowStateCode;
      parentRevisionId: string | null;
    }
  | {
      kind: 'pending';
      reason: RevisionReasonCode;
      parentRevisionId: string | null;
    };

/**
 * Decide a new save/submit before any write. A write against a submitted submission, or one whose
 * base is no longer the head, is kept as a pending revision rather than rejected: the current
 * version and workflow state stay put and staff resolve it later.
 */
export const decideSubmissionWrite = (request: SubmissionWriteRequest): SubmissionWriteDecision => {
  const { submission, eventType, baseRevisionId: base } = request;

  if (isTerminalSubmissionState(submission.workflowState)) {
    return { kind: 'pending', reason: RevisionReason.closed, parentRevisionId: base };
  }

  if (base !== submission.headRevisionId) {
    return { kind: 'pending', reason: RevisionReason.conflict, parentRevisionId: base };
  }

  const workflowState = resolveSubmissionTransition(submission.workflowState, eventType);
  return { kind: 'current', workflowState, parentRevisionId: submission.headRevisionId };
};
