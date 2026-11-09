import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { createDiskTempStorageAdapter } from '../../../../src/core/integrations/temp-storage/diskTempStorage';
import { withTempResource } from '../../../../src/core/integrations/temp-storage/TempStorageAdapter';

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

describe('diskTempStorage', () => {
  let base: string;
  beforeEach(() => {
    base = path.join(os.tmpdir(), `soba-disk-test-${randomUUID()}`);
  });
  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('write returns a real path inside the base dir and stores the bytes', async () => {
    const adapter = createDiskTempStorageAdapter(base);
    const resource = await adapter.write(Buffer.from('hello'), { prefix: 'scan' });
    expect(resource.path).not.toBeNull();
    expect(path.dirname(resource.path)).toBe(path.resolve(base));
    expect(path.basename(resource.path).startsWith('scan-')).toBe(true);
    expect(fs.readFileSync(resource.path, 'utf8')).toBe('hello');
  });

  it('accepts a stream and round-trips via createReadStream', async () => {
    const adapter = createDiskTempStorageAdapter(base);
    const resource = await adapter.write(Readable.from(Buffer.from('streamed')));
    expect(await streamToString(adapter.createReadStream(resource))).toBe('streamed');
  });

  it('removes what a failed write staged', async () => {
    const adapter = createDiskTempStorageAdapter(base);
    const failing = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('source failed'));
      },
    });
    await expect(adapter.write(failing, { prefix: 'scan' })).rejects.toThrow('source failed');
    expect(fs.readdirSync(base)).toEqual([]);
  });

  it('reserves a path in the base dir without creating the file', async () => {
    const adapter = createDiskTempStorageAdapter(base);
    const resource = adapter.reserve({ prefix: 'export' });
    expect(path.dirname(resource.path)).toBe(path.resolve(base));
    expect(path.basename(resource.path).startsWith('export-')).toBe(true);
    expect(fs.existsSync(resource.path)).toBe(false);
    fs.writeFileSync(resource.path, 'written by the caller');
    await adapter.remove(resource);
    await adapter.remove(resource);
    expect(fs.existsSync(resource.path)).toBe(false);
  });

  it('remove deletes the file', async () => {
    const adapter = createDiskTempStorageAdapter(base);
    const resource = await adapter.write(Buffer.from('x'));
    expect(fs.existsSync(resource.path)).toBe(true);
    await adapter.remove(resource);
    expect(fs.existsSync(resource.path)).toBe(false);
  });

  it('ping round-trips a file and resolves true', async () => {
    const adapter = createDiskTempStorageAdapter(base);
    await expect(adapter.ping()).resolves.toBe(true);
    // The healthcheck file is cleaned up, so the dir is left empty.
    expect(fs.readdirSync(base)).toEqual([]);
  });

  it('ping resolves false when the base dir cannot be created', async () => {
    // A regular file as the parent makes mkdir fail (ENOTDIR).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soba-notadir-'));
    const file = path.join(dir, 'file');
    fs.writeFileSync(file, 'x');
    try {
      const adapter = createDiskTempStorageAdapter(path.join(file, 'sub'));
      await expect(adapter.ping()).resolves.toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('withTempResource removes the file even when the callback throws', async () => {
    const adapter = createDiskTempStorageAdapter(base);
    let seen = '';
    await expect(
      withTempResource(adapter, Buffer.from('data'), async (resource) => {
        seen = resource.path;
        expect(fs.existsSync(seen)).toBe(true);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(fs.existsSync(seen)).toBe(false);
  });
});
