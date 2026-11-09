import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
// use fs.promises.mkdir with recursive instead of fs-extra
import type {
  StorageEngineAdapter,
  StoragePluginDefinition,
  UploadFileInput,
  UploadFileResult,
  GetFileResult,
} from '../../core/integrations/storage-engine/StorageEngineAdapter';
import type { PluginConfigReader } from '../../core/config/pluginConfig';
import { storedObjectName } from '../../core/integrations/storage-engine/storageKey';
import { log } from '../../core/logging';

function engineRefFor(relPath: string) {
  return `local:${relPath}`;
}

function parseEngineRef(ref: string) {
  if (!ref.startsWith('local:')) return null;
  return ref.slice('local:'.length);
}

// Refs are adapter-generated, but resolve and contain them so a crafted
// `local:../..` ref can never read or delete outside basePath.
function resolveWithin(basePath: string, rel: string): string | null {
  const base = path.resolve(basePath);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function createLocalStorageAdapter(config: PluginConfigReader): StorageEngineAdapter {
  const basePath = config.getOptional('BASE_PATH') ?? './data/storage';

  async function ensureBase() {
    await fs.promises.mkdir(basePath, { recursive: true });
  }

  return {
    async readinessCheck() {
      try {
        await ensureBase();
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },

    async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
      await ensureBase();
      const subdir = path.join(basePath, input.prefix, input.workspaceId);
      await fs.promises.mkdir(subdir, { recursive: true });
      const dest = path.join(subdir, storedObjectName());

      if (input.buffer) {
        await fs.promises.writeFile(dest, input.buffer);
      } else if (input.stream) {
        try {
          await pipeline(input.stream, fs.createWriteStream(dest));
        } catch (err) {
          await fs.promises.rm(dest, { force: true });
          throw err;
        }
      } else if (input.sourceUrl) {
        // sourceUrl ingestion is not implemented in this adapter.
        throw new Error('sourceUrl uploads are not supported by storage-local adapter');
      } else {
        throw new Error('No payload provided');
      }
      await fs.promises.stat(dest);
      return {
        engineFileRef: engineRefFor(path.relative(basePath, dest)),
        publicUrl: undefined,
        metadata: { filename: input.filename },
      };
    },

    async getFile(engineFileRef: string): Promise<GetFileResult | null> {
      const rel = parseEngineRef(engineFileRef);
      if (!rel) return null;
      const full = resolveWithin(basePath, rel);
      if (!full) return null;
      try {
        const stats = await fs.promises.stat(full);
        return {
          engineFileRef,
          filename: path.basename(full),
          contentType: undefined,
          size: stats.size,
          createdAt: stats.ctime.toISOString(),
          downloadStream: fs.createReadStream(full),
        };
      } catch {
        return null;
      }
    },

    async deleteFile(engineFileRef: string): Promise<void> {
      const rel = parseEngineRef(engineFileRef);
      if (!rel) return;
      const full = resolveWithin(basePath, rel);
      if (!full) return;
      try {
        await fs.promises.unlink(full);
      } catch (err) {
        // Already gone is the outcome a delete wants. The error code only: the path holds the name.
        const code = (err as { code?: unknown }).code;
        if (code !== 'ENOENT')
          log.warn({ plugin: 'storage-local', code }, 'Stored file not deleted');
      }
    },
  };
}

export const storagePluginDefinition: StoragePluginDefinition = {
  code: 'storage-local',
  createAdapter: createLocalStorageAdapter,
};
