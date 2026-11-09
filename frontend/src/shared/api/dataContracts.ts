/**
 * Store-agnostic contracts for the resource-hook layer. A component depends on these shapes, not on
 * how a hook fetches, caches or stores its data, so a hook can move to a different backend without
 * the component changing.
 */

/**
 * A read or write failure, already classified. `cause` is the original error, kept for the console
 * sink. `offline` is a request that got no response.
 */
export type DataError = {
  kind: 'sessionExpired' | 'forbidden' | 'notFound' | 'offline' | 'failed';
  cause: unknown;
};

/** A single record. `data` is null until it loads or after a failure. */
export type Resource<T> = {
  data: T | null;
  isLoading: boolean;
  error: DataError | null;
  refresh: () => Promise<void>;
};

/** A list request. `filters` carries the per-resource filters a list owns beyond paging. */
export type ListQuery = {
  offset: number;
  limit: number;
  sort: string;
  q?: string;
  filters?: Record<string, string>;
};

/**
 * A page of a list. `total` is undefined while it is unknown. `isRefreshing` is a reload with rows
 * already on screen, which the table shows without clearing.
 */
export type ListResult<T> = {
  rows: T[];
  total: number | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  error: DataError | null;
  refresh: () => Promise<void>;
};

/**
 * The outcome of a write. `applied` landed. `held` was kept on the server as a pending revision for
 * review. `queued` is reserved for a device outbox that has not sent yet; nothing returns it yet.
 */
export type WriteOutcome<T> =
  | { status: 'applied'; value: T }
  | { status: 'held'; reason: string }
  | { status: 'queued' };
