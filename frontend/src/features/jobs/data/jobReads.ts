import type { ScopedMutator, SWRConfiguration } from 'swr';
import { isForbidden, isNotFound, isSessionExpired } from '@/src/shared/api/dataError';
import type { JobStatus } from '@/src/types/jobs';

export const ADMIN_JOBS_KEY = 'admin-jobs';
export const SCOPED_JOBS_KEY = 'scoped-jobs';

/** Every jobs list, admin or staff, is cached under one of these as the key's first part. */
const JOB_LIST_KEYS: ReadonlySet<unknown> = new Set([ADMIN_JOBS_KEY, SCOPED_JOBS_KEY]);

export const JOB_POLL_MS = 5000;

/**
 * Reads again every few seconds while `isActive` holds for the last read, so a page follows its work
 * to the end. SWR polls only while the last read succeeded, so a failed read, such as during a
 * backend restart, is tried again on the same beat until one succeeds. An ended session, a refusal
 * or something that is gone is not.
 */
export const pollWhileActive = <T>(isActive: (latest: T) => boolean): SWRConfiguration<T> => ({
  shouldRetryOnError: (err: unknown) =>
    !isSessionExpired(err) && !isForbidden(err) && !isNotFound(err),
  onErrorRetry: (_err, _key, _config, revalidate, { retryCount }) => {
    setTimeout(() => void revalidate({ retryCount }), JOB_POLL_MS);
  },
  refreshInterval: (latest) => (latest !== undefined && isActive(latest) ? JOB_POLL_MS : 0),
});

/**
 * The same, for a caller that tracks whether anything is active itself: the option changes only
 * when `active` does, so other renders do not restart the timer.
 */
export const pollEvery = (active: boolean): SWRConfiguration => ({
  ...pollWhileActive<unknown>(() => active),
  refreshInterval: active ? JOB_POLL_MS : 0,
});

/** How a job page reads its job: again every few seconds while it is queued or running. */
export const jobPollConfig = <T extends { status: JobStatus }>(): SWRConfiguration<T> =>
  pollWhileActive<T>((latest) => latest.status === 'queued' || latest.status === 'running');

/**
 * Drops every jobs list page, admin and staff, so a list that is not showing reads again when it
 * is next shown rather than show a job's old status first.
 */
export const clearJobLists = (mutate: ScopedMutator) =>
  mutate((key) => Array.isArray(key) && JOB_LIST_KEYS.has(key[0]), undefined, {
    revalidate: true,
  });
