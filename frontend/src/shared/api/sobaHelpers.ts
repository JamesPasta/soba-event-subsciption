import { ApiErrorCodeSchema, type ApiErrorCode } from '@soba/lib';
import { NetworkError } from './sobaFetch';

/**
 * Carries the HTTP status so callers can tell a refusal from a failure, and the server's error code
 * when it sent one, so a caller can show its own message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | undefined;
  /** The id the server's logs carry for the request, when its response named one. */
  readonly requestId: string | undefined;

  constructor(message: string, status: number, code?: ApiErrorCode, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * The caller is signed in and the server said no. Distinct from a load that failed, and from an
 * ended session: the API answers a permission refusal with 403, and `sobaFetch` has already turned
 * a 401 an authenticated caller could not refresh past into a `SessionExpiredError`.
 */
export const isForbidden = (err: unknown): boolean => err instanceof ApiError && err.status === 403;

export const isNotFound = (err: unknown): boolean => err instanceof ApiError && err.status === 404;

/** The server refused a write because what it targets changed since the caller read it. */
export const isConflict = (err: unknown): boolean => err instanceof ApiError && err.status === 409;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** The response's request id, only in the UUID form the backend mints: a proxy's may name hosts. */
const requestIdOf = (response: Response): string | undefined => {
  const id = response.headers.get('X-Request-Id');
  return id && UUID.test(id) ? id : undefined;
};

export async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // Surface the backend's `{ error }` message (e.g. name-taken, disclaimer) when present, and its
    // error code when it is one this client knows.
    let message = `Request failed (${response.status})`;
    let code: ApiErrorCode | undefined;
    try {
      const body = (await response.json()) as { error?: unknown; code?: unknown };
      if (typeof body?.error === 'string' && body.error) message = body.error;
      const parsed = ApiErrorCodeSchema.safeParse(body?.code);
      if (parsed.success) code = parsed.data;
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    throw new ApiError(message, response.status, code, requestIdOf(response));
  }
  try {
    // Unchecked cast. A caller that expects a list has to guard for one.
    return (await response.json()) as T;
  } catch (err) {
    // A body cut off mid-read rejects with a TypeError; invalid JSON is a SyntaxError.
    if (err instanceof TypeError) throw new NetworkError(err, requestIdOf(response));
    throw err;
  }
}

/** The response body as a Blob; a refusal throws its ApiError, with the server's code. */
export async function parseBlob(response: Response): Promise<Blob> {
  if (!response.ok) await parseJson(response);
  try {
    return await response.blob();
  } catch (err) {
    // A body cut off mid-read rejects with a TypeError.
    if (err instanceof TypeError) throw new NetworkError(err, requestIdOf(response));
    throw err;
  }
}

/** A downloaded file and the name the server gave it. */
export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** File name from Content-Disposition. */
const dispositionFilename = (response: Response): string => {
  const header = response.headers.get('Content-Disposition') ?? '';
  // The quoted name can itself contain `; filename*=`, so only the trailing filename* is read.
  const encoded = /;\s*filename\*=UTF-8''([^;"\s]+)\s*$/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Malformed encoding; use the plain name.
    }
  }
  return /filename="([^"]*)"/i.exec(header)?.[1] || 'download';
};

/** The file and its name; a refusal throws its ApiError. */
export const parseDownload = async (response: Response): Promise<DownloadedFile> => ({
  blob: await parseBlob(response),
  filename: dispositionFilename(response),
});
