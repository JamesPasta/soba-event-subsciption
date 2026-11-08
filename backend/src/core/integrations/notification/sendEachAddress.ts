import { EmailAddressSchema } from '@soba/lib';
import type { Logger } from 'pino';
import { NotificationOutcome } from '../../db/codes';
import { JobCancelledError } from '../../jobs/settlement';
import type { JobNotifications } from './JobNotifications';
import type { SendEmail } from './NotificationAdapter';
import { isRefusedSend } from './sendOutcome';

export const NOTIFICATIONS_OFF = 'Notifications are off';

/** What a job sends with: its notifications, its stop signal and its log. */
export interface SendEachAddressContext {
  notifications: JobNotifications;
  signal: AbortSignal;
  log: Pick<Logger, 'info' | 'warn'>;
}

export interface SendPolicy {
  /**
   * Checks hourly limits for `toSend` more emails and throws to stop before anything is sent. Runs
   * until the run has handled an address, so a retry finishes a list it started.
   */
  checkBudgets?: (toSend: number) => Promise<void>;
}

interface Tally {
  sent: number;
  refused: number;
}

const normalize = (address: string): string => address.trim().toLowerCase();

const isAddress = (address: string): boolean => EmailAddressSchema.safeParse(address).success;

/** Sends to each address in turn; a failure other than a refusal stops the rest of the list. */
const sendInTurn = async (
  { notifications, signal }: SendEachAddressContext,
  addresses: readonly string[],
  content: SendEmail['content'],
): Promise<Tally> => {
  const sendFrom = async (index: number, tally: Tally): Promise<Tally> => {
    if (index === addresses.length) return tally;
    signal.throwIfAborted();
    const result = await notifications.sendEmail({
      recipients: { to: [addresses[index]] },
      content,
    });
    const stoppedAt = `after ${tally.sent} of ${addresses.length}`;
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
  return sendFrom(0, { sent: 0, refused: 0 });
};

/**
 * Sends one email per address, each address once and in lower case, skipping those already handled
 * for this job. An address no provider would take, or one the provider refuses, is counted as
 * refused and skipped; a fresh list refused at every address ends cancelled. Any other failure, a
 * missing audit row or an abort stops the run and throws, so the job retries and the retry skips
 * what was handled. Logs counts only, never addresses.
 */
export const sendEachAddress = async (
  context: SendEachAddressContext,
  addresses: readonly string[],
  content: SendEmail['content'],
  policy: SendPolicy = {},
): Promise<void> => {
  const { notifications, log } = context;
  const unique = [...new Set(addresses.map(normalize))];
  const valid = unique.filter(isAddress);
  const invalid = unique.length - valid.length;
  const { recipients, runStarted } = await notifications.handled();
  const handled = new Set([...recipients].map(normalize));
  const remaining = valid.filter((address) => !handled.has(address));
  if (remaining.length === 0 && invalid === 0) return;

  let tally: Tally = { sent: 0, refused: 0 };
  if (remaining.length > 0) {
    if (!(await notifications.enabled())) throw new JobCancelledError(NOTIFICATIONS_OFF);
    if (!runStarted) await policy.checkBudgets?.(remaining.length);
    tally = await sendInTurn(context, remaining, content);
  }
  const refused = tally.refused + invalid;
  const counts = { sent: tally.sent, refused, alreadyHandled: handled.size };
  // Every address refused on a fresh list is more likely the request than the addresses.
  if (tally.sent === 0 && handled.size === 0) {
    log.warn(counts, 'Every address was refused');
    throw new JobCancelledError(`Every address was refused (${refused})`);
  }
  if (refused > 0) log.warn(counts, 'Emails sent; some addresses were refused');
  else log.info(counts, 'Emails sent');
};
