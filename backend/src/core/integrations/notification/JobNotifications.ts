import type { SendEmail } from './NotificationAdapter';
import type { SendOutcome } from './sendOutcome';

/** One email send, as the notification service reported and audited it. */
export interface JobEmailResult extends SendOutcome {
  /** False when the audit row could not be written. */
  audited: boolean;
}

/** Where a send count looks: the job's form, its workspace, or the whole environment. */
export type NotificationSendScope = 'form' | 'workspace' | 'environment';

/**
 * The notification service bound to one job: each send carries the job's ids into the audit and is
 * attributed to whoever the job sends for.
 */
export interface JobNotifications {
  enabled(): Promise<boolean>;
  sendEmail(email: SendEmail): Promise<JobEmailResult>;
  /**
   * Addresses this job has already handed to the provider, or that the provider refused since its
   * last re-run, and whether its current run has handled any address yet. A run starts when the job
   * is created, or at its last re-run.
   */
  handled(): Promise<{ recipients: Set<string>; runStarted: boolean }>;
  /**
   * Sends the provider accepted or refused in the last `seconds`, by the database clock. Failures
   * that will be retried are not counted, so an outage does not use up the hour.
   */
  sentSince(scope: NotificationSendScope, seconds: number): Promise<number>;
}
