import type {
  JobDetail,
  JobEmailCounts,
  JobListItem,
  JobSummary,
  JobTypeItem,
  StaffJobActor,
  StaffJobDetail,
  StaffJobListItem,
} from '@soba/lib';
import { JobPool } from '../config/env';
import { JobStatus, JobType } from '../db/codes';
import {
  getJob,
  getJobSummary,
  listChildJobs,
  requeueJob,
  type JobActorRow,
  type JobListRow,
  type JobRow,
  type JobScope,
  type JobSummaryRow,
} from '../db/repos/jobViewRepo';
import { cancelJob, LEASE_EXPIRED } from '../db/repos/jobRepo';
import {
  listJobNotificationSends,
  type JobNotificationSend,
} from '../db/repos/notificationAuditRepo';
import { ConflictError, NotFoundError } from '../errors';
import { isHandledSend, isRefusedSend } from '../integrations/notification/sendOutcome';
import { getPostSubmissionActionPluginDefinitions } from '../integrations/plugins/PluginRegistry';
import { nudgeJobs } from '../jobs';
import { getJobRegistry } from '../jobs/catalog';
import { listJobOutputs, toJobResult, type JobOutput } from '../jobs/outputs';
import { getJobSettings } from '../jobs/settings';
import { log } from '../logging';

const NOT_FOUND = 'Job not found';

const WORD = /\S+/g;

/**
 * Error text with every word that holds an @ replaced, which covers any address it could carry;
 * rows from before error text was cleaned can hold some.
 */
export const redactAddresses = (text: string | null): string | null =>
  text === null ? null : text.replace(WORD, (word) => (word.includes('@') ? '[address]' : word));

/** What decides whether a job may run again. */
export interface RerunFacts {
  status: string;
  type: string;
  /** This environment runs the type. */
  registered: boolean;
  childCount: number;
  /** When the job's run committed its children; kept after retention deletes them. */
  childrenQueuedAt: Date | null;
  finishedAt: Date | null;
  lastError: string | null;
  now: Date;
  /** The lease of the type's pool. */
  leaseMs: number;
}

/**
 * Why a job may not run again, or null when it may. A submission-received job that queued its
 * actions would queue new action jobs once retention freed their dedupe keys, and those would have
 * handled nobody yet, so their emails would go to every address again.
 */
export const rerunRefusal = (facts: RerunFacts): string | null => {
  // An export is the person's own request, under their limit; they start a new one.
  if (facts.type === JobType.submission_export) {
    return "Start a new export from the form's Exports page";
  }
  if (facts.status !== JobStatus.dead && facts.status !== JobStatus.cancelled) {
    return 'Only a dead or cancelled job can be run again';
  }
  if (!facts.registered) return 'This environment does not run jobs of this type';
  if (
    facts.type === JobType.submission_submitted &&
    (facts.childCount > 0 || facts.childrenQueuedAt !== null)
  ) {
    return 'Its actions were queued already; run their jobs again instead';
  }
  const finishedMs = facts.finishedAt ? facts.now.getTime() - facts.finishedAt.getTime() : 0;
  // A job the sweeper ended for an expired lease may still be running on the worker that held it.
  if (facts.lastError === LEASE_EXPIRED && finishedMs < facts.leaseMs) {
    return 'Its last run may still be finishing; try again in a minute';
  }
  return null;
};

/**
 * Where a job's emails stand by address. Sent covers addresses the provider accepted or the
 * notification plugin sent nowhere by design; refused, those the provider refused and never took;
 * pending, the rest. A re-run sends to the pending ones and tries the refused ones again.
 */
export const countEmails = (
  addresses: readonly string[],
  sends: readonly JobNotificationSend[],
): JobEmailCounts => {
  const sent = new Set<string>();
  const refused = new Set<string>();
  for (const send of sends) {
    for (const address of send.recipients.to) {
      if (isRefusedSend(send)) refused.add(address);
      else if (isHandledSend(send)) sent.add(address);
    }
  }
  const sentCount = addresses.filter((address) => sent.has(address)).length;
  const refusedCount = addresses.filter(
    (address) => refused.has(address) && !sent.has(address),
  ).length;
  return {
    addresses: addresses.length,
    sent: sentCount,
    refused: refusedCount,
    pending: addresses.length - sentCount - refusedCount,
  };
};

const optionsOf = (params: Record<string, unknown>): Record<string, unknown> | null => {
  const options = params.options;
  return options !== null && typeof options === 'object' && !Array.isArray(options)
    ? (options as Record<string, unknown>)
    : null;
};

/** The addresses an action job sends to, when its options hold a list of them. */
const addressesOf = (params: Record<string, unknown>): string[] | null => {
  const to = optionsOf(params)?.to;
  if (!Array.isArray(to) || !to.every((address) => typeof address === 'string')) return null;
  return [...new Set(to as string[])];
};

const recordedActionsOf = (params: Record<string, unknown>): string[] =>
  Array.isArray(params.actions)
    ? params.actions.flatMap((action: unknown) => {
        const code = (action as { code?: unknown } | null)?.code;
        return typeof code === 'string' ? [code] : [];
      })
    : [];

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

const statusOf = (status: string): JobListItem['status'] => status as JobListItem['status'];

/** The fields every list item shares, admin or staff. */
const listFacts = (row: JobListRow) => ({
  id: row.id,
  type: row.type,
  status: statusOf(row.status),
  attempts: row.attempts,
  maxAttempts: row.maxAttempts,
  createdAt: row.createdAt.toISOString(),
  runAfter: row.runAfter.toISOString(),
  finishedAt: iso(row.finishedAt),
  cancelRequestedAt: iso(row.cancelRequestedAt),
  requeueCount: row.requeueCount,
  lastError: redactAddresses(row.lastError),
});

export const toJobListItem = (row: JobListRow): JobListItem => ({
  ...listFacts(row),
  workspaceId: row.workspaceId,
  workspaceName: row.workspaceName,
  formId: row.formId,
  formName: row.formName,
  submissionId: row.submissionId,
});

/** A list item for a form's or a workspace's staff: names and the confirmation ID, no ids. */
export const toStaffJobListItem = (row: JobListRow): StaffJobListItem => ({
  ...listFacts(row),
  formName: row.formName,
  confirmationCode: row.confirmationCode,
  submissionId: row.submissionLive ? row.submissionId : null,
});

const toJobSummary = (row: JobSummaryRow): JobSummary => ({
  id: row.id,
  type: row.type,
  status: statusOf(row.status),
  createdAt: row.createdAt.toISOString(),
  finishedAt: iso(row.finishedAt),
});

const standingOf = (actor: JobActorRow): StaffJobActor['standing'] => {
  if (actor.member) return 'member';
  return actor.viaAdmin ? 'platformAdministrator' : 'formerMember';
};

/** Someone outside the job's workspace is not named to its staff, only said to be. */
export const toStaffJobActor = (actor: JobActorRow | null): StaffJobActor | null => {
  if (!actor) return null;
  const standing = standingOf(actor);
  return { standing, displayLabel: standing === 'member' ? actor.displayLabel : null };
};

const adminActorOf = (actor: JobActorRow | null) =>
  actor ? { id: actor.id, displayLabel: actor.displayLabel } : null;

/** A job with what its page shows, as read. */
export interface LoadedJob {
  row: JobRow;
  parent: JobSummaryRow | null;
  children: JobSummaryRow[];
  emailCounts: JobEmailCounts | null;
  output: JobOutput | null;
}

const loadJob = async (scope: JobScope, id: string): Promise<LoadedJob> => {
  const row = await getJob(scope, id);
  if (!row) throw new NotFoundError(NOT_FOUND);
  const addresses = addressesOf(row.params);
  const [parent, children, sends, outputs] = await Promise.all([
    row.parentJobId ? getJobSummary(scope, row.parentJobId) : Promise.resolve(null),
    listChildJobs(scope, row.id),
    addresses ? listJobNotificationSends(row.id) : Promise.resolve(null),
    listJobOutputs([row.id]),
  ]);
  return {
    row,
    parent,
    children,
    emailCounts: addresses && sends ? countEmails(addresses, sends) : null,
    output: outputs.get(row.id) ?? null,
  };
};

/** One job for the admin page, built from named fields only: its options are never returned. */
export const toJobDetail = ({
  row,
  parent,
  children,
  emailCounts,
  output,
}: LoadedJob): JobDetail => ({
  ...toJobListItem(row),
  revisionId: row.revisionId,
  startedAt: iso(row.startedAt),
  createdBy: row.createdBy,
  lastRequeuedAt: iso(row.lastRequeuedAt),
  lastRequeuedBy: adminActorOf(row.lastRequeuedBy),
  cancelRequestedBy: adminActorOf(row.cancelRequestedBy),
  optionNames: Object.keys(optionsOf(row.params) ?? {}),
  recordedActions: recordedActionsOf(row.params),
  parentJobId: row.parentJobId,
  childrenQueuedAt: iso(row.childrenQueuedAt),
  ...(parent ? { parent: toJobSummary(parent) } : {}),
  children: children.map(toJobSummary),
  ...(emailCounts ? { emailCounts } : {}),
  ...(output?.progress ? { progress: output.progress } : {}),
  ...(output?.result ? { result: toJobResult(output.result) } : {}),
});

/** One job for a form's or a workspace's staff: no ids beyond the links, no option names. */
export const toStaffJobDetail = ({
  row,
  parent,
  children,
  emailCounts,
}: LoadedJob): StaffJobDetail => ({
  ...toStaffJobListItem(row),
  startedAt: iso(row.startedAt),
  createdBy: { displayLabel: row.createdBy.displayLabel },
  lastRequeuedAt: iso(row.lastRequeuedAt),
  lastRequeuedBy: toStaffJobActor(row.lastRequeuedBy),
  cancelRequestedBy: toStaffJobActor(row.cancelRequestedBy),
  recordedActions: recordedActionsOf(row.params),
  parentJobId: row.parentJobId,
  childrenQueuedAt: iso(row.childrenQueuedAt),
  ...(parent ? { parent: toJobSummary(parent) } : {}),
  children: children.map(toJobSummary),
  ...(emailCounts ? { emailCounts } : {}),
});

export const getJobDetail = async (id: string): Promise<JobDetail> =>
  toJobDetail(await loadJob({ kind: 'all' }, id));

export const getStaffJobDetail = async (scope: JobScope, id: string): Promise<StaffJobDetail> =>
  toStaffJobDetail(await loadJob(scope, id));

const TYPE_NAMES: Record<string, string> = {
  [JobType.submission_submitted]: 'Submission received',
  [JobType.submission_export]: 'Submission export',
};

/** The job types this environment runs, named for the admin filter. */
export const listJobTypes = (): JobTypeItem[] => {
  const registry = getJobRegistry();
  const pluginNames = new Map(
    getPostSubmissionActionPluginDefinitions().map((plugin) => [plugin.code, plugin.metadata.name]),
  );
  return Object.values(JobPool)
    .flatMap((pool) => registry.typesIn(pool))
    .map((type) => ({ type, name: TYPE_NAMES[type] ?? pluginNames.get(type) ?? type }));
};

/**
 * Run a dead or cancelled job in the scope again as the same row, with the options recorded when it
 * was queued, and wake this pod's pool. The job's own start check still applies.
 */
export const rerunJob = async (scope: JobScope, id: string, actorId: string): Promise<void> => {
  const row = await getJob(scope, id);
  if (!row) throw new NotFoundError(NOT_FOUND);
  const definition = getJobRegistry().get(row.type);
  const settings = getJobSettings();
  const children =
    row.type === JobType.submission_submitted ? await listChildJobs(scope, row.id) : [];
  const refusal = rerunRefusal({
    status: row.status,
    type: row.type,
    registered: definition !== undefined,
    childCount: children.length,
    childrenQueuedAt: row.childrenQueuedAt,
    finishedAt: row.finishedAt,
    lastError: row.lastError,
    now: new Date(),
    leaseMs: definition ? settings.leaseMs[definition.pool] : 0,
  });
  if (refusal) throw new ConflictError(refusal);
  if (!(await requeueJob(scope, id, actorId)))
    throw new ConflictError('The job changed meanwhile; reload it');
  log.info({ jobId: id, jobType: row.type, actorId, scope: scope.kind }, 'Job run again');
  nudgeJobs(row.type);
};

/**
 * Stop a queued or running job in the scope. A queued job ends cancelled now; a running one is asked
 * to stop and ends at its next heartbeat. `stopped` is false while a running job has yet to stop.
 */
export const stopJob = async (
  scope: JobScope,
  id: string,
  actorId: string,
): Promise<{ stopped: boolean }> => {
  const row = await getJob(scope, id);
  if (!row) throw new NotFoundError(NOT_FOUND);
  if (row.status !== JobStatus.queued && row.status !== JobStatus.running) {
    throw new ConflictError('Only a queued or running job can be stopped');
  }
  const result = await cancelJob(row.workspaceId, id, {
    id: actorId,
    admin: scope.kind === 'all',
  });
  if (result === 'not_active') throw new ConflictError('The job finished meanwhile; reload it');
  log.info(
    { jobId: id, jobType: row.type, actorId, scope: scope.kind, result },
    'Job stop requested',
  );
  return { stopped: result === 'cancelled' };
};
