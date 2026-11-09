import {
  Features,
  NotificationChannel,
  NotificationOutcome,
  type NotificationOutcomeCode,
} from '../../core/db/codes';
import { isFeatureEnabledCached } from '../../core/db/repos/featureRepo';
import {
  createNotificationAudit,
  type NewNotificationAudit,
} from '../../core/db/repos/notificationAuditRepo';
import { upstreamStatusOf } from '../../core/http/httpErrorMapper';
import {
  providerDetailOf,
  type NotificationAdapter,
  type SendEmail,
} from '../../core/integrations/notification/NotificationAdapter';
import {
  getNotificationAdapter,
  resolveActivePluginCode,
} from '../../core/integrations/plugins/PluginRegistry';
import { getCorrelationId, log } from '../../core/logging';

const MAX_ERROR_DETAIL = 500;

/** What a notification concerns and who it is attributed to; recorded on its audit row. */
export interface NotificationContext {
  workspaceId: string;
  formId?: string | null;
  submissionId?: string | null;
  /** App user the send is attributed to; the system user when no person triggered it. */
  actorId: string;
  /** The job sending it, when a job is. */
  jobId?: string | null;
}

export interface NotificationSendResult {
  outcome: NotificationOutcomeCode;
  providerMessageId: string | null;
  /** The provider's HTTP status on error; null otherwise or when no response came back. */
  httpStatus: number | null;
  /** Whether the audit row was written. */
  audited: boolean;
}

/** What the notification service needs; the defaults are the feature flag, registry and table. */
export interface NotificationServiceDeps {
  isEnabled: () => Promise<boolean>;
  adapter: () => NotificationAdapter;
  pluginCode: () => string;
  writeAudit: (row: NewNotificationAudit) => Promise<void>;
}

interface Attempt {
  outcome: NotificationOutcomeCode;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  httpStatus?: number | null;
  errorDetail?: string | null;
}

/** Error class, upstream status and the provider's error text, bounded. */
const errorDetail = (err: unknown): string => {
  const name = err instanceof Error ? err.name : 'Error';
  const status = upstreamStatusOf(err);
  const detail = providerDetailOf(err);
  const label = status === undefined ? name : `${name} upstream ${status}`;
  return (detail ? `${label}: ${detail}` : label).slice(0, MAX_ERROR_DETAIL);
};

async function attempt(deps: NotificationServiceDeps, email: SendEmail): Promise<Attempt> {
  try {
    if (!(await deps.isEnabled())) return { outcome: NotificationOutcome.disabled };
    const receipt = await deps.adapter().sendEmail(email);
    if (receipt.id === null) {
      return { outcome: NotificationOutcome.not_sent, providerStatus: receipt.status };
    }
    return {
      outcome: NotificationOutcome.accepted,
      providerMessageId: receipt.id,
      providerStatus: receipt.status,
    };
  } catch (err) {
    return {
      outcome: NotificationOutcome.error,
      httpStatus: upstreamStatusOf(err) ?? null,
      errorDetail: errorDetail(err),
    };
  }
}

/**
 * Builds the email sender. Never throws: the outcome is returned and recorded on one audit row per
 * call. A failed audit write is logged, and the result says so in `audited`.
 */
export const createNotificationService = (deps: NotificationServiceDeps) => ({
  /** Whether the notifications feature is on. */
  enabled: (): Promise<boolean> => deps.isEnabled(),

  async sendEmail(context: NotificationContext, email: SendEmail): Promise<NotificationSendResult> {
    const startedAt = Date.now();
    const result = await attempt(deps, email);
    const pluginCode = deps.pluginCode();
    if (result.outcome === NotificationOutcome.error) {
      // The audit row holds the provider's text; the log keeps to fields without recipients.
      log.error(
        {
          pluginCode,
          httpStatus: result.httpStatus,
          workspaceId: context.workspaceId,
          submissionId: context.submissionId,
        },
        'Notification send failed',
      );
    }
    let audited = false;
    try {
      await deps.writeAudit({
        workspaceId: context.workspaceId,
        formId: context.formId,
        submissionId: context.submissionId,
        pluginCode,
        channel: NotificationChannel.email,
        outcome: result.outcome,
        recipients: email.recipients,
        subject: email.content.subject,
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus,
        httpStatus: result.httpStatus,
        errorDetail: result.errorDetail,
        durationMs: Date.now() - startedAt,
        requestId: getCorrelationId() ?? null,
        jobId: context.jobId ?? null,
        createdBy: context.actorId,
      });
      audited = true;
    } catch (err) {
      // The database error carries the insert's values, recipients among them; log its name only.
      log.error(
        {
          pluginCode,
          workspaceId: context.workspaceId,
          submissionId: context.submissionId,
          errorName: err instanceof Error ? err.name : 'Error',
        },
        'Failed to write notification audit',
      );
    }
    return {
      outcome: result.outcome,
      providerMessageId: result.providerMessageId ?? null,
      httpStatus: result.httpStatus ?? null,
      audited,
    };
  },
});

export const notificationService = createNotificationService({
  isEnabled: () => isFeatureEnabledCached(Features.notifications, Date.now()),
  adapter: getNotificationAdapter,
  pluginCode: () => resolveActivePluginCode('notification'),
  writeAudit: createNotificationAudit,
});
