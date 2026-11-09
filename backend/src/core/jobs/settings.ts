import { env, type JobSettings } from '../config/env';

/** A failed write of a job's outcome is tried this many more times before the lease is left. */
export const OUTCOME_WRITE_RETRIES = 3;
export const OUTCOME_WRITE_RETRY_MS = 1000;

let settings: JobSettings | undefined;

/** JOB_* settings, read once per process. Throws when a set value is not valid. */
export const getJobSettings = (): JobSettings => {
  settings ??= env.getJobSettings();
  return settings;
};

/**
 * Throws unless the longest job shutdown (drain, abort grace, outcome write retries) ends before the
 * shutdown timeout. The server closes only after it, so it needs the time that is left.
 */
export const assertJobShutdownFits = (jobs: JobSettings, shutdownTimeoutMs: number): void => {
  const writesMs = OUTCOME_WRITE_RETRIES * OUTCOME_WRITE_RETRY_MS;
  const neededMs = jobs.drainMs + jobs.abortGraceMs + writesMs;
  if (neededMs >= shutdownTimeoutMs) {
    throw new Error(
      `JOB_DRAIN_MS + JOB_ABORT_GRACE_MS + ${writesMs} ms of outcome writes is ${neededMs} ms; it must be under SHUTDOWN_TIMEOUT_MS (${shutdownTimeoutMs} ms)`,
    );
  }
};
