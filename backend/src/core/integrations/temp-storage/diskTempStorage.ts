/** Disk-backed TempStorageAdapter shared by tempstorage-os and tempstorage-mount;
 *  they differ only in base dir. */
import { randomUUID } from 'node:crypto';
import { createReadStream as fsCreateReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { TempResource, TempStorageAdapter, TempWriteOptions } from './TempStorageAdapter';

export function createDiskTempStorageAdapter(baseDir: string): TempStorageAdapter {
  const root = path.resolve(baseDir);
  let ensured = false;
  const ensureRoot = (): void => {
    if (!ensured) {
      mkdirSync(root, { recursive: true });
      ensured = true;
    }
  };

  const adapter: TempStorageAdapter = {
    async write(data: Buffer | Readable, opts?: TempWriteOptions): Promise<TempResource> {
      const resource = adapter.reserve(opts);
      const source = Buffer.isBuffer(data) ? Readable.from(data) : data;
      try {
        await pipeline(source, createWriteStream(resource.path));
      } catch (err) {
        await adapter.remove(resource);
        throw err;
      }
      return resource;
    },

    reserve(opts?: TempWriteOptions): TempResource {
      ensureRoot();
      const id = randomUUID();
      return { id, path: path.join(root, `${opts?.prefix ?? 'soba'}-${id}`) };
    },

    createReadStream(resource: TempResource): Readable {
      return fsCreateReadStream(resource.path);
    },

    async remove(resource: TempResource): Promise<void> {
      await rm(resource.path, { force: true });
    },

    async ping(): Promise<boolean> {
      try {
        const resource = await adapter.write(Buffer.from('ok'), { prefix: 'healthcheck' });
        await adapter.remove(resource);
        return true;
      } catch {
        return false;
      }
    },
  };

  return adapter;
}
