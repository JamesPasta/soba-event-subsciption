import { db } from '../../core/db/client';
import {
  insertJob,
  markChildrenQueued,
  type ClaimedJob,
  type NewJob,
} from '../../core/db/repos/jobRepo';
import { findInstalledPostSubmissionAction } from '../../core/integrations/post-submission-action/PostSubmissionActionRegistry';
import type { JobContext } from '../../core/jobs/registry';
import { getJobSettings } from '../../core/jobs/settings';
import { SubmittedJobParamsSchema } from './params';
import { isSubmissionLive } from './repo';
import type { SubmittedAction } from './resolve';

/** One action's job: a child of the submitted job, at most one per action and revision. */
export const childJob = (
  parent: ClaimedJob,
  action: SubmittedAction,
  maxAttempts: number,
): NewJob => ({
  type: action.code,
  workspaceId: parent.workspaceId,
  formId: parent.formId,
  submissionId: parent.submissionId,
  revisionId: parent.revisionId,
  parentJobId: parent.id,
  actionConfigId: action.source.settingId,
  createdBy: parent.createdBy,
  params: { options: action.options, source: action.source },
  dedupeKey: `${action.code}:${parent.revisionId}`,
  maxAttempts,
});

/** The plugin's attempts, or JOB_MAX_ATTEMPTS on a pod that does not have the plugin. */
export const childAttempts = (code: string): number =>
  findInstalledPostSubmissionAction(code)?.job.maxAttempts ?? getJobSettings().maxAttempts;

/**
 * The submitted job's run: queue one job per action recorded with the submission, in one
 * transaction. Dedupe keys make a retry safe. Only a pod with an action's plugin claims its job, and
 * the job's start check decides whether it runs.
 */
export const fanOutSubmitted = async ({ job, log }: JobContext): Promise<void> => {
  log.info({ submissionId: job.submissionId, revisionId: job.revisionId }, 'Submission received');
  const { actions } = SubmittedJobParamsSchema.parse(job.params);
  if (actions.length === 0) return;

  const live =
    job.submissionId !== null &&
    (await isSubmissionLive(db, { workspaceId: job.workspaceId, submissionId: job.submissionId }));
  if (!live) {
    log.info('Post-submission actions skipped: the submission, its form or its workspace is gone');
    return;
  }

  // The mark outlives the children, so a re-run is refused once they were queued, even after
  // retention deletes them and frees their dedupe keys.
  const jobIds = await db.transaction(async (tx) => {
    if (!(await markChildrenQueued(tx, job.id, job.claimToken))) {
      throw new Error('The job is no longer held; its actions were not queued');
    }
    return Promise.all(
      actions.map((action) => insertJob(tx, childJob(job, action, childAttempts(action.code)))),
    );
  });
  log.info(
    {
      // A null job id means the action was already queued for this revision.
      queued: actions.map((action, index) => ({ code: action.code, jobId: jobIds[index] })),
    },
    'Post-submission actions queued',
  );
};
