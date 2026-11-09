/**
 * Pluggable temp storage for staging transient bytes (e.g. an upload before
 * processing). Plugins tempstorage-os / tempstorage-mount (both disk, different
 * base dir), selected via TEMPSTORAGE_DEFAULT_CODE. Stream-based, but every
 * resource also has a real filesystem `path`.
 */
import type { Readable } from 'node:stream';
import type { PluginConfigReader } from '../../config/pluginConfig';

/** A staged transient resource, backed by a real filesystem path. */
export interface TempResource {
  id: string;
  path: string;
}

export interface TempWriteOptions {
  /** Filename prefix. */
  prefix?: string;
}

export interface TempStorageAdapter {
  /** Stage bytes (Buffer or stream) and return a handle. A failed write leaves nothing behind. */
  write(data: Buffer | Readable, opts?: TempWriteOptions): Promise<TempResource>;
  /**
   * A handle for a file the caller writes itself, such as through a write stream. Nothing exists at
   * the path yet; the caller removes the handle when done, whether or not it wrote anything.
   */
  reserve(opts?: TempWriteOptions): TempResource;
  /** Open a readable stream over a previously staged resource. */
  createReadStream(resource: TempResource): Readable;
  /** Remove a staged resource. No-op if it is already gone. */
  remove(resource: TempResource): Promise<void>;
  /** Health check: round-trip a tiny file (write then remove). Used by readiness. */
  ping(): Promise<boolean>;
}

export interface TempStoragePluginDefinition {
  code: string;
  createAdapter: (config: PluginConfigReader) => TempStorageAdapter;
}

/** Stage `data`, run `fn` with the handle, then remove it even if `fn` throws. */
export async function withTempResource<T>(
  adapter: TempStorageAdapter,
  data: Buffer | Readable,
  fn: (resource: TempResource) => Promise<T>,
  opts?: TempWriteOptions,
): Promise<T> {
  const resource = await adapter.write(data, opts);
  try {
    return await fn(resource);
  } finally {
    await adapter.remove(resource);
  }
}
