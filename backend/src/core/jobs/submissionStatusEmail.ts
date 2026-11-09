import { z } from 'zod';
import { JobPool } from '../config/env';
import { JobType } from '../db/codes';
import type { JobTypeSpec } from './registry';

/** What a status email job is given: the change it is about, and whether the comment goes in. */
export const StatusEmailJobParamsSchema = z.object({
  statusChangeId: z.uuid(),
  options: z.object({ attachComment: z.boolean() }),
});
export type StatusEmailJobParams = z.infer<typeof StatusEmailJobParamsSchema>;

/**
 * Queued with a review status change that sends an email. The catalog attaches its run, so queuing
 * it does not load the handler.
 */
export const submissionStatusEmailJob: JobTypeSpec = {
  type: JobType.submission_status_email,
  pool: JobPool.light,
  // About an hour of retries at the default backoff, to ride out a provider outage.
  maxAttempts: 8,
  timeoutMs: 300_000,
};
