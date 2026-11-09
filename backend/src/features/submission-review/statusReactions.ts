import type { SubmissionReviewStatus } from '@soba/lib';
import type { JobTypeSpec } from '../../core/jobs/registry';
import { getJobSettings } from '../../core/jobs/settings';
import { submissionStatusEmailJob } from '../../core/jobs/submissionStatusEmail';
import { notificationService } from '../notifications/service';
import { sendsStatusEmail } from './statusEmails';

/** A reaction to record with a status change: its job type and the options it runs with. */
export interface StatusReaction {
  code: string;
  options: Record<string, unknown>;
}

/** What a reaction's rule reads about the change. */
export interface StatusChangeFacts {
  status: SubmissionReviewStatus;
  assigneeId: string | null;
  actorId: string;
  /** A submitter sent their own submission back to revise, rather than a reviewer making it. */
  bySubmitter: boolean;
  /** The reviewer chose to put their comment in the email. */
  attachComment: boolean;
}

/** Something a status change can set off, as its own job. */
export interface StatusReactionDefinition {
  job: JobTypeSpec;
  /** Whether the reaction can run here at all; checked before the change's transaction. */
  available: () => Promise<boolean>;
  /** The options to record, or null when this change does not call for the reaction. */
  options: (facts: StatusChangeFacts) => Record<string, unknown> | null;
}

/**
 * What a status change sets off, in order. A reviewer's change emails the assignee or the
 * submitters; a submitter sending their own submission back to revise emails no one.
 */
export const STATUS_REACTIONS: readonly StatusReactionDefinition[] = [
  {
    job: submissionStatusEmailJob,
    available: () => notificationService.enabled(),
    options: (facts) =>
      !facts.bySubmitter && sendsStatusEmail(facts.status, facts.assigneeId, facts.actorId)
        ? { attachComment: facts.attachComment }
        : null,
  },
];

/**
 * The reactions that can run here, in order. Feature checks read on the pool, so a status change
 * runs this before its transaction takes a connection.
 */
export const availableStatusReactions = async (
  reactions: readonly StatusReactionDefinition[] = STATUS_REACTIONS,
): Promise<StatusReactionDefinition[]> => {
  const available = await Promise.all(reactions.map((reaction) => reaction.available()));
  return reactions.filter((_reaction, index) => available[index]);
};

/** The reactions to record with a change: each available one whose rule the change meets. */
export const chooseStatusReactions = (
  facts: StatusChangeFacts,
  reactions: readonly StatusReactionDefinition[],
): StatusReaction[] =>
  reactions.flatMap((reaction) => {
    const options = reaction.options(facts);
    return options ? [{ code: reaction.job.type, options }] : [];
  });

/** A reaction's attempts, or JOB_MAX_ATTEMPTS for a code this build does not know. */
export const reactionAttempts = (code: string): number =>
  STATUS_REACTIONS.find((reaction) => reaction.job.type === code)?.job.maxAttempts ??
  getJobSettings().maxAttempts;
