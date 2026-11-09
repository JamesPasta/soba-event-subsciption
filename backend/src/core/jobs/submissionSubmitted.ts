import { JobPool } from '../config/env';
import { JobType } from '../db/codes';
import type { JobTypeSpec } from './registry';

/**
 * Queued when a submit lands as the new head. The catalog attaches its run, the post-submission
 * fan-out, so queuing it does not build the job registry.
 */
export const submissionSubmittedJob: JobTypeSpec = {
  type: JobType.submission_submitted,
  pool: JobPool.light,
};
