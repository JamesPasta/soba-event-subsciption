import type { Tx } from '../db/client';
import { JobType, SubmissionEventType, type SubmissionWriteEventCode } from '../db/codes';
import { insertJob, type NewJob } from '../db/repos/jobRepo';
import type { SubmissionRecord } from '../db/repos/submissionRepo';
import { resolveSubmittedActions, type ScopedAction } from '../../features/post-submission/resolve';
import type { StatusChangedJobParams } from '../../features/submission-review/params';
import {
  chooseStatusReactions,
  type StatusChangeFacts,
  type StatusReactionDefinition,
} from '../../features/submission-review/statusReactions';
import { getJobSettings } from './settings';
import { submissionStatusChangedJob } from './submissionStatusChanged';
import { submissionSubmittedJob } from './submissionSubmitted';

/** A submit queues the submitted job where post-submission is available. A save never checks. */
export const queuesSubmittedJob = async (
  eventType: SubmissionWriteEventCode,
  isAvailable: () => Promise<boolean>,
): Promise<boolean> => eventType === SubmissionEventType.submitted && (await isAvailable());

/**
 * Queue the submitted job in the transaction that lands the submit. One job per revision. Its params
 * record which of `actions` the form's settings turn on now, so later settings changes do not alter
 * them.
 */
export const enqueueSubmittedJob = async (
  tx: Tx,
  submission: SubmissionRecord,
  revisionId: string,
  actorId: string,
  actions: readonly ScopedAction[],
): Promise<void> => {
  const submitted = await resolveSubmittedActions(
    tx,
    submission.workspaceId,
    submission.formId,
    actions,
  );
  await insertJob(tx, {
    type: JobType.submission_submitted,
    workspaceId: submission.workspaceId,
    formId: submission.formId,
    submissionId: submission.id,
    revisionId,
    createdBy: actorId,
    params: { actions: submitted },
    dedupeKey: `${JobType.submission_submitted}:${revisionId}`,
    maxAttempts: submissionSubmittedJob.maxAttempts ?? getJobSettings().maxAttempts,
  });
};

/** A review status change as its job records it. */
export interface StatusChangeEvent extends StatusChangeFacts {
  /** The change's id, which the client chose. */
  id: string;
  workspaceId: string;
  formId: string;
  submissionId: string;
}

/**
 * The status-changed job for a change: one per change. Its params record which of `reactions` the
 * change calls for now, so later changes do not alter them.
 */
export const statusChangedJob = (
  change: StatusChangeEvent,
  reactions: readonly StatusReactionDefinition[],
): NewJob => {
  const params: StatusChangedJobParams = {
    statusChangeId: change.id,
    actions: chooseStatusReactions(change, reactions),
  };
  return {
    type: JobType.submission_status_changed,
    workspaceId: change.workspaceId,
    formId: change.formId,
    submissionId: change.submissionId,
    createdBy: change.actorId,
    params,
    dedupeKey: `${JobType.submission_status_changed}:${change.id}`,
    maxAttempts: submissionStatusChangedJob.maxAttempts ?? getJobSettings().maxAttempts,
  };
};

/** Queue the status-changed job in the transaction that makes the change. */
export const enqueueStatusChangedJob = async (
  tx: Tx,
  change: StatusChangeEvent,
  reactions: readonly StatusReactionDefinition[],
): Promise<void> => {
  await insertJob(tx, statusChangedJob(change, reactions));
};
