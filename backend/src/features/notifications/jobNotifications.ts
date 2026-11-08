import type { ClaimedJob } from '../../core/db/repos/jobRepo';
import {
  countNotificationsSince,
  listJobNotificationSends,
  type NotificationCountScope,
} from '../../core/db/repos/notificationAuditRepo';
import type {
  JobNotifications,
  NotificationSendScope,
} from '../../core/integrations/notification/JobNotifications';
import {
  hasRunStarted,
  isHandledForRun,
  REFUSED_HTTP_STATUSES,
} from '../../core/integrations/notification/sendOutcome';
import { notificationService } from './service';

const countScope = (scope: NotificationSendScope, job: ClaimedJob): NotificationCountScope => {
  if (scope === 'environment') return { kind: 'environment' };
  if (scope === 'workspace' || job.formId === null)
    return { kind: 'workspace', id: job.workspaceId };
  return { kind: 'form', id: job.formId };
};

/**
 * The notification service for one job. Sends carry the job's ids into the audit and are
 * attributed to the user `actorId` resolves to, read at each send.
 */
export const jobNotifications = (
  job: ClaimedJob,
  actorId: () => Promise<string>,
): JobNotifications => ({
  enabled: () => notificationService.enabled(),

  async sendEmail(email) {
    const { outcome, httpStatus, audited } = await notificationService.sendEmail(
      {
        workspaceId: job.workspaceId,
        formId: job.formId,
        submissionId: job.submissionId,
        actorId: await actorId(),
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
