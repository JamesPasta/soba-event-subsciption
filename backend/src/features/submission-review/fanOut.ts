import { db } from '../../core/db/client';
import {
  insertJob,
  markChildrenQueued,
  type ClaimedJob,
  type NewJob,
} from '../../core/db/repos/jobRepo';
import type { JobContext } from '../../core/jobs/registry';
import { isSubmissionLive } from '../post-submission/repo';
import { StatusChangedJobParamsSchema } from './params';
import { reactionAttempts, type StatusReaction } from './statusReactions';

/** One reaction's job: a child of the status-changed job, at most one per reaction and change. */
export const reactionJob = (
  parent: ClaimedJob,
  statusChangeId: string,
  reaction: StatusReaction,
  maxAttempts: number,
): NewJob => ({
  type: reaction.code,
  workspaceId: parent.workspaceId,
  formId: parent.formId,
  submissionId: parent.submissionId,
  parentJobId: parent.id,
  createdBy: parent.createdBy,
  params: { ...reaction.options, statusChangeId },
  dedupeKey: `${reaction.code}:${statusChangeId}`,
  maxAttempts,
});

/**
 * The status-changed job's run: queue one job per reaction recorded with the change, in one
 * transaction. Dedupe keys make a retry safe. Each reaction's job decides whether it still runs.
 */
export const fanOutStatusChanged = async ({ job, log }: JobContext): Promise<void> => {
  const { statusChangeId, actions } = StatusChangedJobParamsSchema.parse(job.params);
  log.info({ submissionId: job.submissionId, statusChangeId }, 'Status changed');
  if (actions.length === 0) return;

  const live =
    job.submissionId !== null &&
    (await isSubmissionLive(db, { workspaceId: job.workspaceId, submissionId: job.submissionId }));
  if (!live) {
    log.info('Status change reactions skipped: the submission, its form or its workspace is gone');
    return;
  }

  // The mark outlives the children, so a re-run is refused once they were queued, even after
  // retention deletes them and frees their dedupe keys.
  const jobIds = await db.transaction(async (tx) => {
    if (!(await markChildrenQueued(tx, job.id, job.claimToken))) {
      throw new Error('The job is no longer held; its reactions were not queued');
    }
    return Promise.all(
      actions.map((action) =>
        insertJob(tx, reactionJob(job, statusChangeId, action, reactionAttempts(action.code))),
      ),
    );
  });
  log.info(
    {
      // A null job id means the reaction was already queued for this change.
      queued: actions.map((action, index) => ({ code: action.code, jobId: jobIds[index] })),
    },
    'Status change reactions queued',
  );
};
