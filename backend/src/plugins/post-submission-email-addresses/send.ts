import type { PostSubmissionEmailAddressesOptions } from '@soba/lib';
import { sendEachAddress } from '../../core/integrations/notification/sendEachAddress';
import type { PostSubmissionActionContext } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import { JobCancelledError } from '../../core/jobs/settlement';
import { exceededLimit, type HourlyLimits } from './limits';
import { buildNotice } from './notice';

const HOUR_SECONDS = 3600;

type SendContext = PostSubmissionActionContext<PostSubmissionEmailAddressesOptions>;

/**
 * The reason a job gives when a limit stops it. Its readers are the form's and workspace's staff, so
 * the environment's reason carries no numbers: those describe every workspace's email.
 */
export const LIMIT_REACHED_ENVIRONMENT =
  'Hourly email limit for this environment reached; try again later';

/** Ends the job cancelled, before anything is sent, when this list would pass an hourly limit. */
const checkBudgets = async (
  { services: { notifications }, log }: Pick<SendContext, 'services' | 'log'>,
  toSend: number,
  limits: HourlyLimits,
): Promise<void> => {
  const [form, workspace, environment] = await Promise.all([
    notifications.sentSince('form', HOUR_SECONDS),
    notifications.sentSince('workspace', HOUR_SECONDS),
    notifications.sentSince('environment', HOUR_SECONDS),
  ]);
  const over = exceededLimit({ form, workspace, environment }, toSend, limits);
  if (over) {
    log.warn({ ...over, toSend }, 'Post-submission email over an hourly limit');
    throw new JobCancelledError(
      over.scope === 'environment'
        ? LIMIT_REACHED_ENVIRONMENT
        : `Hourly email limit for the ${over.scope} reached: ${toSend} to send, limit ${over.limit}`,
    );
  }
};

/**
 * Sends the notice to each listed address not yet handled for this job, one email per address,
 * within the form's, workspace's and environment's hourly limits.
 */
export const sendNotices = (
  { options, submission, services, signal, log }: SendContext,
  limits: HourlyLimits,
  designerAppUrl: string | undefined,
): Promise<void> =>
  sendEachAddress(
    { notifications: services.notifications, signal, log },
    options.to,
    buildNotice(submission, designerAppUrl),
    { checkBudgets: (toSend) => checkBudgets({ services, log }, toSend, limits) },
  );
