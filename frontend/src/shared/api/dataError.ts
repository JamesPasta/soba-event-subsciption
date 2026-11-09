import type { ApiErrorCode } from '@soba/lib';
import type { DataError } from './dataContracts';
import { isNetworkError, isSessionExpired } from './sobaFetch';
import { ApiError, isForbidden, isNotFound } from './sobaHelpers';

/**
 * The single place an API failure becomes a `DataError`. Callers outside the api folder reach the
 * error predicates through here so they do not import the fetch module directly.
 */
export function classifyDataError(cause: unknown): DataError {
  if (isSessionExpired(cause)) return { kind: 'sessionExpired', cause };
  if (isForbidden(cause)) return { kind: 'forbidden', cause };
  if (isNotFound(cause)) return { kind: 'notFound', cause };
  if (isNetworkError(cause)) return { kind: 'offline', cause };
  return { kind: 'failed', cause };
}

/** Messages per error kind. `failed` is the fallback for any kind the caller does not name. */
export type DataErrorMessages = Partial<Record<DataError['kind'], string>> & { failed: string };

export function messageForDataError(error: DataError, messages: DataErrorMessages): string {
  return messages[error.kind] ?? messages.failed;
}

/**
 * A server failure (5xx) or no response at all: the write may or may not have landed, so a retry
 * must replay it.
 */
export const isOutcomeUnknown = (cause: unknown): boolean =>
  (cause instanceof ApiError && cause.status >= 500) || isNetworkError(cause);

/**
 * The message for an error the server sent a code with. Without a code, or with one `messages`
 * leaves out, `failed` stands in for a server failure, no response, or an error that is not from
 * the API. Any other client error (4xx) and an ended session are null, so the caller can show the
 * server's text or the session message.
 */
export function apiErrorMessage(
  cause: unknown,
  messages: Partial<Record<ApiErrorCode, string>>,
  failed?: string,
): string | null {
  const coded = cause instanceof ApiError && cause.code ? messages[cause.code] : undefined;
  if (coded !== undefined) return coded;
  if (failed === undefined || isSessionExpired(cause)) return null;
  if (cause instanceof ApiError) return cause.status >= 500 ? failed : null;
  return failed;
}

export { isNetworkError, isSessionExpired } from './sobaFetch';
export { isForbidden, isNotFound, isConflict } from './sobaHelpers';
