import * as Minio from 'minio';
import { Readable } from 'node:stream';
import type {
  StorageEngineAdapter,
  StoragePluginDefinition,
  UploadFileInput,
  UploadFileResult,
  GetFileResult,
} from '../../core/integrations/storage-engine/StorageEngineAdapter';
import type { PluginConfigReader } from '../../core/config/pluginConfig';
import { isStoragePrefix } from '../../core/integrations/storage-engine/storageKey';
import { log } from '../../core/logging';
import { objectKey, ownedKey } from './objectKey';

const CODE = 'storage-s3';
const PART_SIZE = 16 * 1024 * 1024;

/**
 * S3-compatible (MinIO) storage plugin adapter.
 *
 * Config is read per storage profile, so keys use the STORAGE_PROFILE_<PROFILE>_ prefix
 * (e.g. STORAGE_PROFILE_DEFAULT_ENDPOINT), not a plugin-code prefix:
 * - ENDPOINT (http(s)://host[:port] or host)
 * - PORT (optional): for a URL without a port, else the scheme's default (443 or 80); for a host,
 *   else 9000
 * - USE_SSL (true/false): for a host only; a URL takes SSL from its scheme
 * - ACCESS_KEY
 * - SECRET_KEY
 * - BUCKET_NAME or BUCKET
 * - PREFIX (optional): root every object is stored under, e.g. `dev`
 *
 * Reads and deletes act only on refs in the profile's bucket and under its root.
 */
function createMinioAdapter(config: PluginConfigReader): StorageEngineAdapter {
  const endpointRaw = config.getRequired('ENDPOINT');
  const portRaw = config.getOptional('PORT');
  let endPointHost: string;
  let port: number;
  let useSSL: boolean;

  try {
    const parsed = new URL(endpointRaw);
    endPointHost = parsed.hostname;
    useSSL = parsed.protocol === 'https:';
    // URL leaves out the scheme's default port, so an https URL without one is 443, not 9000.
    port = Number(parsed.port || portRaw || (useSSL ? '443' : '80'));
  } catch {
    // Not a full URL, treat as host string
    endPointHost = endpointRaw;
    useSSL = (config.getOptional('USE_SSL') ?? 'false') === 'true';
    port = Number(portRaw ?? '9000');
  }

  const accessKey = config.getRequired('ACCESS_KEY');
  const secretKey = config.getRequired('SECRET_KEY');
  const bucket =
    config.getOptional('BUCKET') ??
    config.getOptional('BUCKET_NAME') ??
    config.getRequired('BUCKET_NAME');
  const root = config.getOptional('PREFIX');
  if (root !== undefined && !isStoragePrefix(root)) {
    throw new Error(`Invalid storage profile PREFIX '${root}'`);
  }

  const client = new Minio.Client({
    endPoint: endPointHost,
    port,
    useSSL,
    accessKey,
    secretKey,
    // Each part is held in memory while it uploads; minio's own choice for a large or unsized
    // stream runs to hundreds of MiB.
    partSize: PART_SIZE,
  });

  /**
   * Upload a stream, rejecting when the source fails or closes before its end; minio's upload
   * otherwise waits on such a source forever. A failed upload's parts are removed.
   */
  async function putStream(
    key: string,
    source: Readable,
    size: number | undefined,
    contentType: string,
  ): Promise<void> {
    let stop = (): void => undefined;
    const sourceFailed = new Promise<never>((_resolve, reject) => {
      const onError = (err: Error) => reject(err);
      const onClose = () => {
        if (!source.readableEnded) reject(new Error('Upload source closed before its end'));
      };
      source.once('error', onError);
      source.once('close', onClose);
      stop = () => {
        source.off('error', onError);
        source.off('close', onClose);
      };
    });
    try {
      await Promise.race([
        client.putObject(bucket, key, source, size, { 'Content-Type': contentType }),
        sourceFailed,
      ]);
    } catch (err) {
      source.destroy();
      await client.removeIncompleteUpload(bucket, key).catch((removeErr: unknown) => {
        log.warn({ err: removeErr, plugin: CODE }, 'Incomplete upload not removed');
      });
      throw err;
    } finally {
      stop();
    }
  }

  function engineRefFor(key: string) {
    return `s3:${bucket}:${key}`;
  }

  function keyFor(engineFileRef: string): string | null {
    const key = ownedKey(engineFileRef, bucket, root);
    if (key === null) {
      log.warn({ plugin: CODE }, 'Stored ref is outside the profile bucket and root; ignored');
    }
    return key;
  }

  return {
    async readinessCheck() {
      try {
        const exists = await client.bucketExists(bucket);
        return { ok: exists };
      } catch (err: unknown) {
        return { ok: false, message: String(err) };
      }
    },

    async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
      const key = objectKey(root, input);
      if (input.buffer) {
        const stream = Readable.from(input.buffer);
        await client.putObject(bucket, key, stream, input.buffer.length, {
          'Content-Type': input.contentType || 'application/octet-stream',
        });
      } else if (input.stream) {
        await putStream(
          key,
          input.stream as Readable,
          input.size,
          input.contentType || 'application/octet-stream',
        );
      } else if (input.sourceUrl) {
        // Implementation could fetch the source URL and stream into putObject.
        throw new Error('sourceUrl uploads are not supported by storage-s3 adapter');
      } else {
        throw new Error('Only buffer/stream uploads supported');
      }
      return {
        engineFileRef: engineRefFor(key),
        publicUrl: undefined,
        metadata: { filename: input.filename },
      };
    },

    async getFile(engineFileRef: string): Promise<GetFileResult | null> {
      const key = keyFor(engineFileRef);
      if (key === null) return null;
      try {
        const stat = await client.statObject(bucket, key);
        const stream = await client.getObject(bucket, key);
        return {
          engineFileRef,
          filename: key.split('/').pop() ?? key,
          contentType: stat.metaData?.['content-type'] as string | undefined,
          size: stat.size,
          createdAt: stat.lastModified?.toISOString(),
          downloadStream: stream,
        };
      } catch {
        return null;
      }
    },

    async deleteFile(engineFileRef: string): Promise<void> {
      const key = keyFor(engineFileRef);
      if (key === null) return;
      try {
        await client.removeObject(bucket, key);
      } catch (err) {
        // The error code only: the key holds the name.
        const code = (err as { code?: unknown }).code;
        log.warn({ plugin: CODE, code }, 'Stored file not deleted');
      }
    },
  };
}

export const storagePluginDefinition: StoragePluginDefinition = {
  code: CODE,
  createAdapter: createMinioAdapter,
};
