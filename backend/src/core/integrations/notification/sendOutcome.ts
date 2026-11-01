import { NotificationOutcome, type NotificationOutcomeCode } from '../../db/codes';

/** One send as the notification service reports and audits it. */
export interface SendOutcome {
  outcome: NotificationOutcomeCode;
  httpStatus: number | null;
}

/**
 * Statuses with which the provider refuses an address, as the Notify test safelist does: sending
 * it again would be refused again. Any other error status is the provider or its gateway.
 */
export const REFUSED_HTTP_STATUSES: readonly number[] = [400, 422];

export const isRefusedSend = ({ outcome, httpStatus }: SendOutcome): boolean =>
  outcome === NotificationOutcome.error &&
  httpStatus !== null &&
  REFUSED_HTTP_STATUSES.includes(httpStatus);

/** A send that needs no retry: handed to the provider, sent nowhere by design, or refused. */
export const isHandledSend = (send: SendOutcome): boolean =>
  send.outcome === NotificationOutcome.accepted ||
  send.outcome === NotificationOutcome.not_sent ||
  isRefusedSend(send);

/**
 * A send that leaves its address handled for a job's current run. A refusal counts only since the
 * job's last re-run, so a re-run tries a refused address again, such as one added to the provider's
 * safelist since.
 */
export const isHandledForRun = (
  send: SendOutcome & { createdAt: Date },
  rerunAt: Date | null,
): boolean =>
  isHandledSend(send) && !(isRefusedSend(send) && rerunAt !== null && send.createdAt < rerunAt);

/**
 * Whether a job's current run has handled an address yet. A run starts when the job is created, or
 * at its last re-run.
 */
export const hasRunStarted = (
  sends: readonly (SendOutcome & { createdAt: Date })[],
  rerunAt: Date | null,
): boolean =>
  sends.some((send) => isHandledSend(send) && (rerunAt === null || send.createdAt >= rerunAt));
