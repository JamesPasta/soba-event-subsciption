import { JobPool } from '../config/env';
import { JobType } from '../db/codes';
import type { JobTypeSpec } from './registry';

/**
 * Queued when a review status change lands. The catalog attaches its run, the status-change fan-out,
 * so queuing it does not build the job registry.
 */
export const submissionStatusChangedJob: JobTypeSpec = {
  type: JobType.submission_status_changed,
  pool: JobPool.light,
};
