import type { ClaimedJob } from '../../core/db/repos/jobRepo';
import {
  countNotificationsSince,
  listJobNotificationSends,
  type NotificationCountScope,
} from '../../core/db/repos/notificationAuditRepo';
import type {
  PostSubmissionActionNotifications,
  PostSubmissionActionSendScope,
} from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import {
  hasRunStarted,
  isHandledForRun,
  REFUSED_HTTP_STATUSES,
} from '../../core/integrations/notification/sendOutcome';
import { getSystemUser } from '../../core/services/systemUser';
import { notificationService } from '../notifications/service';

const countScope = (
  scope: PostSubmissionActionSendScope,
  job: ClaimedJob,
): NotificationCountScope => {
  if (scope === 'environment') return { kind: 'environment' };
  if (scope === 'workspace' || job.formId === null)
    return { kind: 'workspace', id: job.workspaceId };
  return { kind: 'form', id: job.formId };
};

/**
 * The notification service for one action job. Sends are attributed to the system user, since the
 * submitter chose neither the recipients nor the text, and carry the job's ids into the audit.
 */
export const actionNotifications = (job: ClaimedJob): PostSubmissionActionNotifications => ({
  enabled: () => notificationService.enabled(),

  async sendEmail(email) {
    const systemUser = await getSystemUser();
    if (!systemUser) throw new Error('The system user is missing');
    const { outcome, httpStatus, audited } = await notificationService.sendEmail(
      {
        workspaceId: job.workspaceId,
        formId: job.formId,
        submissionId: job.submissionId,
        actorId: systemUser.id,
        jobId: job.id,
      },
      email,
    );
    return { outcome, httpStatus, audited };
  },

  async handled() {
    const sends = await listJobNotificationSends(job.id);
    return {
      recipients: new Set(
        sends
          .filter((send) => isHandledForRun(send, job.lastRequeuedAt))
          .flatMap((send) => send.recipients.to),
      ),
      runStarted: hasRunStarted(sends, job.lastRequeuedAt),
    };
  },

  sentSince: (scope, seconds) =>
    countNotificationsSince(countScope(scope, job), seconds, REFUSED_HTTP_STATUSES),
});
