import { Readable } from 'node:stream';
import { v7 as uuidv7 } from 'uuid';
import type {
  StorageEngineAdapter,
  StoragePluginDefinition,
  UploadFileInput,
  UploadFileResult,
  GetFileResult,
} from '../../core/integrations/storage-engine/StorageEngineAdapter';
import type { PluginConfigReader } from '../../core/config/pluginConfig';

/**
 * In-memory storage plugin adapter.
 *
 * Keeps uploaded bytes in a process-local Map — no filesystem, no external service, no
 * credentials. Everything is lost when the process exits or restarts. That makes it the safe
 * default for ephemeral environments (PR namespaces, local dev, tests) where files should not
 * outlive the pod and where mounting a PVC or wiring S3 would be overkill.
 *
 * Not suitable for durable, multi-replica environments: each replica holds its own Map, so a
 * file uploaded to one pod is invisible to the others, and nothing survives a restart. Point
 * those environments at 'storage-s3' (or 'storage-local' with a shared volume) instead.
 */
interface StoredObject {
  buffer: Buffer;
  filename: string;
  contentType?: string;
  createdAt: string;
}

function engineRefFor(id: string) {
  return `memory:${id}`;
}

function parseEngineRef(ref: string): string | null {
  if (!ref.startsWith('memory:')) return null;
  return ref.slice('memory:'.length);
}

/** Rejects when the stream fails or closes before its end. */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createMemoryStorageAdapter(_config: PluginConfigReader): StorageEngineAdapter {
  const store = new Map<string, StoredObject>();

  return {
    readinessCheck() {
      // Always ready — there is no backing service to reach.
      return Promise.resolve({ ok: true });
    },

    async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
      let buffer: Buffer;
      if (input.buffer) {
        buffer = input.buffer;
      } else if (input.stream) {
        buffer = await streamToBuffer(input.stream);
      } else if (input.sourceUrl) {
        throw new Error('sourceUrl uploads are not supported by storage-memory adapter');
      } else {
        throw new Error('No payload provided');
      }

      const id = uuidv7();
      store.set(id, {
        buffer,
        filename: input.filename,
        contentType: input.contentType,
        createdAt: new Date().toISOString(),
      });

      return {
        engineFileRef: engineRefFor(id),
        publicUrl: undefined,
        metadata: { filename: input.filename },
      };
    },

    getFile(engineFileRef: string): Promise<GetFileResult | null> {
      const id = parseEngineRef(engineFileRef);
      const obj = id ? store.get(id) : undefined;
      if (!obj) return Promise.resolve(null);
      return Promise.resolve({
        engineFileRef,
        filename: obj.filename,
        contentType: obj.contentType,
        size: obj.buffer.length,
        createdAt: obj.createdAt,
        downloadStream: Readable.from(obj.buffer),
      });
    },

    deleteFile(engineFileRef: string): Promise<void> {
      const id = parseEngineRef(engineFileRef);
      if (id) store.delete(id);
      return Promise.resolve();
    },
  };
}

export const storagePluginDefinition: StoragePluginDefinition = {
  code: 'storage-memory',
  createAdapter: createMemoryStorageAdapter,
};
