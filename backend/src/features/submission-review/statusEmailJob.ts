import type { ClaimedJob } from '../../core/db/repos/jobRepo';
import {
  findStatusChangeForEmail,
  findStatusEmailFacts,
  findUserEmail,
  type StatusChangeForEmail,
  type StatusEmailFacts,
} from '../../core/db/repos/submissionReviewRepo';
import { sendEachAddress } from '../../core/integrations/notification/sendEachAddress';
import type { JobContext } from '../../core/jobs/registry';
import { JobCancelledError } from '../../core/jobs/settlement';
import { StatusEmailJobParamsSchema } from '../../core/jobs/submissionStatusEmail';
import { jobNotifications } from '../notifications/jobNotifications';
import { canReviewForm } from './assignee';
import {
  renderStatusEmail,
  StatusEmailAudience,
  statusEmailFor,
  type StatusEmail,
} from './statusEmails';

/** Who the email goes to, read when the job runs; ends the job cancelled, with why, when no one. */
const recipientsFor = async (
  email: StatusEmail,
  change: StatusChangeForEmail,
  facts: StatusEmailFacts,
): Promise<string[]> => {
  // No one is emailed about a change they made themselves, so the facts leave them out.
  if (email.audience === StatusEmailAudience.submitters) {
    if (facts.submitterEmails.length === 0) {
      throw new JobCancelledError(
        'No submitter other than the person who made the change has an email address',
      );
    }
    return facts.submitterEmails;
  }
  const { assigneeId } = change;
  if (!assigneeId) throw new JobCancelledError('No one was assigned');
  if (assigneeId === change.changedBy) {
    throw new JobCancelledError('Assigned to the person who made the change; no email sent');
  }
  if (!(await canReviewForm(change.workspaceId, facts.formId, assigneeId))) {
    throw new JobCancelledError('The assignee can no longer review this form');
  }
  const address = await findUserEmail(assigneeId);
  if (!address) throw new JobCancelledError('The assignee has no email address');
  return [address];
};

/** The change exists and is about the job's own submission. */
const isJobsChange = (
  change: StatusChangeForEmail | null,
  job: ClaimedJob,
): change is StatusChangeForEmail =>
  change?.submissionId === job.submissionId && change.workspaceId === job.workspaceId;

/**
 * Sends the email a review status change calls for, after the change has committed. A later change
 * makes it out of date, so the job then ends cancelled. Recipients are read when the job runs. Sends
 * are attributed to whoever made the change, or to whoever ran the job again.
 */
export const runStatusEmailJob = async ({ job, signal, log }: JobContext): Promise<void> => {
  const { statusChangeId, attachComment } = StatusEmailJobParamsSchema.parse(job.params);
  const change = await findStatusChangeForEmail(statusChangeId);
  if (!isJobsChange(change, job)) throw new JobCancelledError('The status change is gone');
  if (!change.current) throw new JobCancelledError('The status has changed since; no email sent');
  const email = statusEmailFor(change.status);
  if (!email) throw new JobCancelledError('This status sends no email');
  const facts = await findStatusEmailFacts(
    change.workspaceId,
    change.submissionId,
    change.changedBy,
  );
  if (!facts) throw new JobCancelledError('The submission is gone');
  const to = await recipientsFor(email, change, facts);
  const comment = attachComment ? (change.comment ?? undefined) : undefined;
  const actorId = job.lastRequeuedBy ?? job.createdBy;
  await sendEachAddress(
    { notifications: jobNotifications(job, () => Promise.resolve(actorId)), signal, log },
    to,
    renderStatusEmail(email, facts, change.submissionId, comment),
  );
};
