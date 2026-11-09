import type { PostSubmissionEmailAddressesOptions } from '@soba/lib';
import { NotificationOutcome } from '../../core/db/codes';
import { isRefusedSend } from '../../core/integrations/notification/sendOutcome';
import type { PostSubmissionActionContext } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import { JobCancelledError } from '../../core/jobs/settlement';
import { exceededLimit, type HourlyLimits } from './limits';
import { buildNotice, type Notice } from './notice';

const HOUR_SECONDS = 3600;

type SendContext = PostSubmissionActionContext<PostSubmissionEmailAddressesOptions>;

const NOTIFICATIONS_OFF = 'Notifications are off';

interface Tally {
  sent: number;
  refused: number;
}

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
 * Sends the notice to each address not yet handled for this job, one email per address. A refused
 * address is recorded and skipped; a fresh list refused at every address ends cancelled. Any other
 * failure, a missing audit row or an abort stops the run and throws, so the job retries and the
 * retry skips what was handled. Budgets are checked until the run has handled an address, so a retry
 * finishes a started list; a run starts when the job is created, or when it is run again.
 */
export const sendNotices = async (
  { options, submission, services, signal, log }: SendContext,
  limits: HourlyLimits,
  link: string | null,
): Promise<void> => {
  const { notifications } = services;
  const { recipients: handled, runStarted } = await notifications.handled();
  const remaining = options.to.filter((address) => !handled.has(address));
  if (remaining.length === 0) return;
  if (!(await notifications.enabled())) throw new JobCancelledError(NOTIFICATIONS_OFF);
  if (!runStarted) await checkBudgets({ services, log }, remaining.length, limits);

  const notice: Notice = buildNotice(submission, link);
  // One send at a time, so a failure stops the rest of the list.
  const sendFrom = async (index: number, tally: Tally): Promise<Tally> => {
    if (index === remaining.length) return tally;
    signal.throwIfAborted();
    const result = await notifications.sendEmail({
      recipients: { to: [remaining[index]] },
      content: { subject: notice.subject, body: notice.body, bodyType: 'text' },
    });
    const stoppedAt = `after ${tally.sent} of ${remaining.length}`;
    if (!result.audited) throw new Error(`A send was not recorded; stopping ${stoppedAt}`);
    if (result.outcome === NotificationOutcome.disabled) {
      throw new JobCancelledError(NOTIFICATIONS_OFF);
    }
    if (isRefusedSend(result)) return sendFrom(index + 1, { ...tally, refused: tally.refused + 1 });
    if (result.outcome === NotificationOutcome.error) {
      throw new Error(`Email send failed (status ${result.httpStatus ?? 'none'}) ${stoppedAt}`);
    }
    return sendFrom(index + 1, { ...tally, sent: tally.sent + 1 });
  };
  const { sent, refused } = await sendFrom(0, { sent: 0, refused: 0 });
  const counts = { sent, refused, alreadyHandled: handled.size };
  // Every address refused on a fresh list is more likely the request than the addresses.
  if (refused === remaining.length && handled.size === 0) {
    log.warn(counts, 'Post-submission email refused for every address');
    throw new JobCancelledError(`The provider refused every address (${refused})`);
  }
  if (refused > 0) log.warn(counts, 'Post-submission email sent; some addresses were refused');
  else log.info(counts, 'Post-submission email sent');
};
