import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import {
  RevisionReason,
  RevisionStatus,
  SubmissionEventType,
  SubmissionWorkflowState,
  type RevisionReasonCode,
  type RevisionStatusCode,
} from '../codes';
import { submissionRevisions } from '../schema';

/**
 * Resolve where a write lands, from the submission under the lock. A 'current' intent applies as
 * current/accepted while the submission is open and its head still matches the base. Otherwise it is
 * kept as pending: `closed` when the submission is submitted, `conflict` when only the head moved.
 * Ending a revision can close a submission without moving its head, so the head alone does not show
 * it. A 'pending' intent keeps the gate's reason.
 */
export const resolveRevisionStanding = (
  intent: Extract<RevisionStatusCode, 'current' | 'pending'>,
  gateReason: RevisionReasonCode,
  headMoved: boolean,
  workflowState: string,
): { applyAsCurrent: boolean; status: RevisionStatusCode; reason: RevisionReasonCode } => {
  if (intent !== RevisionStatus.current) {
    return { applyAsCurrent: false, status: RevisionStatus.pending, reason: gateReason };
  }
  if (workflowState === SubmissionWorkflowState.submitted) {
    return { applyAsCurrent: false, status: RevisionStatus.pending, reason: RevisionReason.closed };
  }
  if (headMoved) {
    return {
      applyAsCurrent: false,
      status: RevisionStatus.pending,
      reason: RevisionReason.conflict,
    };
  }
  return { applyAsCurrent: true, status: RevisionStatus.current, reason: RevisionReason.accepted };
};

/** Append order over all revisions; the current version's number lives in current_revision_no. */
export const nextRevisionNo = async (
  tx: Tx,
  workspaceId: string,
  submissionId: string,
): Promise<number> => {
  const [{ next }] = await tx
    .select({
      next: sql<number>`coalesce(max(${submissionRevisions.revisionNo}), -1) + 1`,
    })
    .from(submissionRevisions)
    .where(
      and(
        eq(submissionRevisions.submissionId, submissionId),
        eq(submissionRevisions.workspaceId, workspaceId),
      ),
    );
  return Number(next);
};

/** The outgoing head is the single current revision; demote it before the new head commits. */
export const demoteHead = async (
  tx: Tx,
  workspaceId: string,
  headRevisionId: string | null,
): Promise<void> => {
  if (!headRevisionId) return;
  await tx
    .update(submissionRevisions)
    .set({ status: RevisionStatus.superseded, reason: RevisionReason.replaced })
    .where(
      and(
        eq(submissionRevisions.id, headRevisionId),
        eq(submissionRevisions.workspaceId, workspaceId),
      ),
    );
};

/** The head a restore leaves: the revision now current, its number and its answer document. */
export interface RestoredHead {
  headRevisionId: string;
  currentRevisionNo: number;
  engineSubmissionRef: string | null;
}

/** The revisions that settle the answers; a submitter's saves while revising do not. */
const SETTLED_EVENTS = [
  SubmissionEventType.submitted,
  SubmissionEventType.edited,
  SubmissionEventType.restored,
];

/**
 * Make the last settled answers current again, inside the caller's transaction, which holds the
 * submission's row lock. Answer documents are never changed, so the restore is a new current
 * revision pointing at the settled revision's document. Null when the head already is that revision,
 * or nothing was ever submitted.
 */
export const restoreLastSettled = async (
  tx: Tx,
  input: {
    workspaceId: string;
    submissionId: string;
    headRevisionId: string | null;
    engineSubmissionRef: string | null;
    actorId: string;
  },
): Promise<RestoredHead | null> => {
  const [lastSettled] = await tx
    .select({
      id: submissionRevisions.id,
      afterEngineSubmissionRef: submissionRevisions.afterEngineSubmissionRef,
    })
    .from(submissionRevisions)
    .where(
      and(
        eq(submissionRevisions.workspaceId, input.workspaceId),
        eq(submissionRevisions.submissionId, input.submissionId),
        inArray(submissionRevisions.eventType, SETTLED_EVENTS),
        ne(submissionRevisions.status, RevisionStatus.pending),
      ),
    )
    .orderBy(desc(submissionRevisions.revisionNo))
    .limit(1);
  if (!lastSettled || lastSettled.id === input.headRevisionId) return null;

  const revisionNo = await nextRevisionNo(tx, input.workspaceId, input.submissionId);
  await demoteHead(tx, input.workspaceId, input.headRevisionId);
  const [restored] = await tx
    .insert(submissionRevisions)
    .values({
      workspaceId: input.workspaceId,
      submissionId: input.submissionId,
      revisionNo,
      parentRevisionId: input.headRevisionId,
      eventType: SubmissionEventType.restored,
      status: RevisionStatus.current,
      reason: RevisionReason.accepted,
      beforeEngineSubmissionRef: input.engineSubmissionRef,
      afterEngineSubmissionRef: lastSettled.afterEngineSubmissionRef,
      changedBy: input.actorId,
    })
    .returning({ id: submissionRevisions.id });
  return {
    headRevisionId: restored.id,
    currentRevisionNo: revisionNo,
    engineSubmissionRef: lastSettled.afterEngineSubmissionRef,
  };
};
