import type { Tx } from '../db/client';
import { JobType, SubmissionEventType, type SubmissionWriteEventCode } from '../db/codes';
import { insertJob } from '../db/repos/jobRepo';
import type { SubmissionRecord } from '../db/repos/submissionRepo';
import { resolveSubmittedActions, type ScopedAction } from '../../features/post-submission/resolve';
import { getJobSettings } from './settings';
import { submissionStatusEmailJob, type StatusEmailJobParams } from './submissionStatusEmail';
import { submissionSubmittedJob } from './submissionSubmitted';

/**
 * Queue the email a review status change sends, in the transaction that makes the change. One job
 * per change; true when this call queued it.
 */
export const enqueueStatusEmailJob = async (
  tx: Tx,
  input: {
    workspaceId: string;
    formId: string;
    submissionId: string;
    actorId: string;
  } & StatusEmailJobParams,
): Promise<boolean> => {
  const params: StatusEmailJobParams = {
    statusChangeId: input.statusChangeId,
    attachComment: input.attachComment,
  };
  const id = await insertJob(tx, {
    type: JobType.submission_status_email,
    workspaceId: input.workspaceId,
    formId: input.formId,
    submissionId: input.submissionId,
    createdBy: input.actorId,
    params,
    dedupeKey: `${JobType.submission_status_email}:${input.statusChangeId}`,
    maxAttempts: submissionStatusEmailJob.maxAttempts ?? getJobSettings().maxAttempts,
  });
  return id !== null;
};

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
