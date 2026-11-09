import { and, count, eq, gte, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../client';
import { NotificationOutcome, type NotificationOutcomeCode } from '../codes';
import { notificationAudits, type NotificationAuditRecipients } from '../schema';

export type NotificationAuditRecord = typeof notificationAudits.$inferSelect;

export interface NewNotificationAudit {
  workspaceId: string;
  formId?: string | null;
  submissionId?: string | null;
  pluginCode: string;
  channel: string;
  outcome: NotificationOutcomeCode;
  recipients: NotificationAuditRecipients;
  subject?: string | null;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  httpStatus?: number | null;
  errorDetail?: string | null;
  durationMs: number;
  requestId?: string | null;
  jobId?: string | null;
  createdBy: string;
}

export const createNotificationAudit = async (input: NewNotificationAudit): Promise<void> => {
  await db.insert(notificationAudits).values({
    workspaceId: input.workspaceId,
    formId: input.formId ?? null,
    submissionId: input.submissionId ?? null,
    pluginCode: input.pluginCode,
    channel: input.channel,
    outcome: input.outcome,
    recipients: input.recipients,
    subject: input.subject ?? null,
    providerMessageId: input.providerMessageId ?? null,
    providerStatus: input.providerStatus ?? null,
    httpStatus: input.httpStatus ?? null,
    errorDetail: input.errorDetail ?? null,
    durationMs: input.durationMs,
    requestId: input.requestId ?? null,
    jobId: input.jobId ?? null,
    createdBy: input.createdBy,
  });
};

/** One audited send of a job: its outcome, who it went to, and when. */
export interface JobNotificationSend {
  outcome: NotificationOutcomeCode;
  httpStatus: number | null;
  recipients: NotificationAuditRecipients;
  createdAt: Date;
}

export const listJobNotificationSends = (jobId: string): Promise<JobNotificationSend[]> =>
  db
    .select({
      outcome: notificationAudits.outcome,
      httpStatus: notificationAudits.httpStatus,
      recipients: notificationAudits.recipients,
      createdAt: notificationAudits.createdAt,
    })
    .from(notificationAudits)
    .where(eq(notificationAudits.jobId, jobId));

/** Which audit rows to count: one form's, one workspace's, or every row. */
export type NotificationCountScope =
  | { kind: 'form'; id: string }
  | { kind: 'workspace'; id: string }
  | { kind: 'environment' };

/**
 * Sends the provider dealt with in the last `seconds`, by the database clock: accepted, or refused
 * with one of `refusedStatuses`. Failures to be retried are not counted.
 */
export const countNotificationsSince = async (
  scope: NotificationCountScope,
  seconds: number,
  refusedStatuses: readonly number[],
): Promise<number> => {
  const filters: SQL[] = [
    or(
      eq(notificationAudits.outcome, NotificationOutcome.accepted),
      and(
        eq(notificationAudits.outcome, NotificationOutcome.error),
        inArray(notificationAudits.httpStatus, [...refusedStatuses]),
      ),
    ) as SQL,
    gte(notificationAudits.createdAt, sql`now() - make_interval(secs => ${seconds})`),
  ];
  if (scope.kind === 'form') filters.push(eq(notificationAudits.formId, scope.id));
  if (scope.kind === 'workspace') filters.push(eq(notificationAudits.workspaceId, scope.id));
  const [row] = await db
    .select({ total: count() })
    .from(notificationAudits)
    .where(and(...filters));
  return row?.total ?? 0;
};
