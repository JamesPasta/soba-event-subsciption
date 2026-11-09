import type { Logger } from 'pino';
import type { z } from 'zod';
import type { PostSubmissionActionScope } from '@soba/lib';
import type { JobPoolCode } from '../../config/env';
import type { ClaimedJob } from '../../db/repos/jobRepo';
import type { SendEmail } from '../notification/NotificationAdapter';
import type { SendOutcome } from '../notification/sendOutcome';

export type { PostSubmissionActionScope };

/** The saved settings an action job runs with. */
export interface PostSubmissionActionSource {
  scope: PostSubmissionActionScope;
  settingId: string;
  version: number;
}

/** The submission an action job runs for, with names as they are when the job runs. */
export interface PostSubmissionActionSubmission {
  id: string;
  formId: string;
  formName: string;
  workspaceId: string;
  workspaceName: string;
  confirmationCode: string;
}

/** One email send, as the notification service reported and audited it. */
export interface PostSubmissionActionEmailResult extends SendOutcome {
  /** False when the audit row could not be written. */
  audited: boolean;
}

/** Where a send count looks: the job's form, its workspace, or the whole environment. */
export type PostSubmissionActionSendScope = 'form' | 'workspace' | 'environment';

/** The notification service, bound to the job: sends are attributed to the system user. */
export interface PostSubmissionActionNotifications {
  enabled(): Promise<boolean>;
  sendEmail(email: SendEmail): Promise<PostSubmissionActionEmailResult>;
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
  sentSince(scope: PostSubmissionActionSendScope, seconds: number): Promise<number>;
}

/** Services the framework passes to an action, so plugins do not import feature code. */
export interface PostSubmissionActionServices {
  notifications: PostSubmissionActionNotifications;
}

export interface PostSubmissionActionContext<TOptions> {
  job: ClaimedJob;
  /** The options saved when the submission was received, parsed by the plugin's schema. */
  options: TOptions;
  source: PostSubmissionActionSource;
  submission: PostSubmissionActionSubmission;
  services: PostSubmissionActionServices;
  signal: AbortSignal;
  log: Logger;
}

/**
 * A post-submission action plugin: a folder under plugins/ exporting this as
 * `postSubmissionActionPluginDefinition`. POST_SUBMISSION_ACTION_PLUGINS enables it per environment.
 */
export interface PostSubmissionActionPluginDefinition<TOptions = Record<string, unknown>> {
  /** The action's key in settings and its job type. */
  code: string;
  metadata: { code: string; name: string; description?: string; version?: string };
  /** When set, the action is configurable and runs only where this feature is available. */
  featureCode?: string;
  /** Where it is configured. Without `form`, every form follows the workspace's default. */
  scopes: PostSubmissionActionScope[];
  /**
   * Parses saved options, on save and before each run. Saved settings and queued jobs keep the
   * options as they were saved, so it must keep accepting earlier shapes, converting them to the
   * current one; a save stores what it returns.
   */
  optionsSchema: z.ZodType<TOptions>;
  job: {
    pool: JobPoolCode;
    maxAttempts?: number;
    timeoutMs?: number;
    /**
     * Returning means the action is done; throwing retries it. Stop and throw when the signal
     * aborts. It can run more than once, so its side effects must be safe to repeat. An error's
     * message is stored on the job and logged, so it must not carry recipients or submission data.
     */
    run: (context: PostSubmissionActionContext<TOptions>) => Promise<void>;
  };
}
