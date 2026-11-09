import type { Readable } from 'node:stream';
import type { PluginConfigReader } from '../../config/pluginConfig';

/**
 * Result of a storage engine readiness check; no credentials or sensitive config are exposed.
 */
export interface StorageEngineReadinessResult {
  ok: boolean;
  message?: string;
}

/**
 * A single file's metadata as returned by the storage engine.
 * Implementations may add provider-specific fields in `metadata`.
 */
export type StorageFileMeta = {
  /** Engine-assigned stable reference for the file (opaque). */
  engineFileRef: string;
  /** Original filename as uploaded. */
  filename: string;
  /** MIME content type (when known). */
  contentType?: string;
  /** Size in bytes (when known). */
  size?: number;
  /** Optional publicly addressable URL (if the backend exposes one). */
  publicUrl?: string;
  /** Provider-specific metadata bag (ACLs, etags, custom tags). */
  metadata?: Record<string, unknown>;
  /** ISO timestamp when the object was created in the storage backend. */
  createdAt?: string;
};

/**
 * Input accepted when uploading a file to the storage engine. To support multiple
 * environments (server-side direct upload, presigned-url flows) adapters may accept
 * either raw bytes/streams or a source URL which the adapter will ingest.
 */
export interface UploadFileInput {
  /** SOBA workspace id — used for tenancy and scoping in the storage backend. */
  workspaceId: string;
  /** Key prefix of the feature that owns the file; the backend stores the object under it. */
  prefix: string;
  /** Original filename provided by the client. */
  filename: string;
  /** Content type hint. */
  contentType?: string;
  /** Optional size hint in bytes. */
  size?: number;
  /** The file payload: either a Buffer, a Readable stream, or omitted when using a sourceUrl. */
  buffer?: Buffer;
  stream?: NodeJS.ReadableStream;
  /** Optional source URL the adapter should fetch/ingest (useful for server-side copies). */
  sourceUrl?: string;
  /** Optional metadata to attach to the stored object. */
  metadata?: Record<string, unknown>;
}

export interface UploadFileResult {
  /** Stable engine reference for the newly stored file. */
  engineFileRef: string;
  /** Optional public URL (if the backend exposes or generates one). */
  publicUrl?: string;
  /** Returned/normalized metadata. */
  metadata?: Record<string, unknown>;
}

export interface GetFileResult extends StorageFileMeta {
  /** When available, a stream to read the file contents server-side (may be omitted). */
  downloadStream?: Readable;
}

/**
 * Storage engine adapter contract. Implementations (local, minio, s3, etc.) should
 * implement this interface to plug into SOBA's storage abstraction.
 */
export interface StorageEngineAdapter {
  /** Optional: report whether the storage backend is reachable. */
  readinessCheck?(): Promise<StorageEngineReadinessResult>;

  /**
   * Upload a file into the storage backend. Implementations should be idempotent where
   * possible (for example by deduplication using a content hash) but callers should not
   * rely on dedupe unless documented by the adapter.
   */
  uploadFile(input: UploadFileInput): Promise<UploadFileResult>;

  /** Read file metadata and optionally a download stream. Returns null if not found. */
  getFile(engineFileRef: string): Promise<GetFileResult | null>;

  /** Delete a stored file by engine reference. */
  deleteFile(engineFileRef: string): Promise<void>;

  /**
   * Optional transform hook to normalize provider-specific metadata into a portable shape.
   */
  normalizeMetadata?(
    metadata: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined;
}

/**
 * Definition a storage plugin exports as `storagePluginDefinition`. Discovered by the plugin
 * registry and instantiated per storage profile (see STORAGE_PROFILE_<PROFILE>_BACKEND).
 */
export interface StoragePluginDefinition {
  readonly code: string;
  createAdapter(config: PluginConfigReader): StorageEngineAdapter;
}
