import type { Tx } from '../db/client';
import { JobType, SubmissionEventType, type SubmissionWriteEventCode } from '../db/codes';
import { insertJob } from '../db/repos/jobRepo';
import type { SubmissionRecord } from '../db/repos/submissionRepo';
import { resolveSubmittedActions, type ScopedAction } from '../../features/post-submission/resolve';
import { getJobSettings } from './settings';
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
