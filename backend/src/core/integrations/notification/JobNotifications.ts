import type { SendEmail } from './NotificationAdapter';
import type { SendOutcome } from './sendOutcome';

/** One email send, as the notification service reported and audited it. */
export interface JobEmailResult extends SendOutcome {
  /** False when the audit row could not be written. */
  audited: boolean;
}

/** Where a job's sends stand. A run starts when the job is created, or at its last re-run. */
export interface HandledAddresses {
  /** Addresses already handed to the provider, or that the provider refused since the last re-run. */
  recipients: Set<string>;
  /** The current run has handled an address. */
  runStarted: boolean;
  /** Any of the job's emails reached its address, in any run. */
  anySent: boolean;
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
  /** Where this job's sends stand, from its audit rows. */
  handled(): Promise<HandledAddresses>;
  /**
   * Sends the provider accepted or refused in the last `seconds`, by the database clock. Failures
   * that will be retried are not counted, so an outage does not use up the hour.
   */
  sentSince(scope: NotificationSendScope, seconds: number): Promise<number>;
}
