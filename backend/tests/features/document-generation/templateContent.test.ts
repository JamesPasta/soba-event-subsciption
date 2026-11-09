import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'node:stream';
import {
  readTemplateContent,
  readWithin,
  settleBy,
} from '../../../src/features/document-generation/templateContent';
import { getStorageAdapter } from '../../../src/core/integrations/plugins/PluginRegistry';
import type { DocumentTemplateWithFile } from '../../../src/core/db/repos/documentTemplateRepo';

// Real storage: the storage-local plugin under a temp folder.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'template-content-'));
process.env.STORAGE_PROFILES = 'default';
process.env.STORAGE_PROFILE_DEFAULT_BACKEND = 'storage-local';
process.env.STORAGE_PROFILE_DEFAULT_BASE_PATH = tmp;

async function storeTemplate(body: string): Promise<DocumentTemplateWithFile> {
  const { engineFileRef } = await getStorageAdapter('default').uploadFile({
    workspaceId: 'ws1',
    prefix: 'templates',
    filename: 'receipt.docx',
    buffer: Buffer.from(body),
  });
  return {
    template: { id: 'tpl-1' },
    file: {
      id: 'file-1',
      profile: 'default',
      backendRef: engineFileRef,
      filename: 'receipt.docx',
      size: body.length,
    },
  } as unknown as DocumentTemplateWithFile;
}

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('readWithin', () => {
  it('joins every chunk', async () => {
    const stream = Readable.from([Buffer.from('ab'), Buffer.from('cd')]);
    const read = await readWithin(stream, 10, 1000);
    expect(Buffer.isBuffer(read) && read.toString()).toBe('abcd');
  });

  it('stops at the chunk that passes the limit, and destroys the stream', async () => {
    const stream = Readable.from([Buffer.alloc(10), Buffer.alloc(10), Buffer.alloc(10)]);
    await expect(readWithin(stream, 15, 1000)).resolves.toBe('too-large');
    expect(stream.destroyed).toBe(true);
  });

  it('gives up on a stream that stalls, and destroys it', async () => {
    const stalled = new Readable({ read() {} });
    await expect(readWithin(stalled, 10, 20)).resolves.toBe('timeout');
    expect(stalled.destroyed).toBe(true);
  });
});

describe('settleBy', () => {
  it('returns a value that arrives in time', async () => {
    await expect(
      settleBy(Promise.resolve('opened'), Date.now() + 1000, () => undefined),
    ).resolves.toBe('opened');
  });

  it('gives up at the deadline and hands a late value to onLate', async () => {
    let arrive: (value: string) => void = () => undefined;
    const late = new Promise<string>((resolve) => (arrive = resolve));
    const onLate = jest.fn();

    await expect(settleBy(late, Date.now() + 20, onLate)).resolves.toBe('timeout');

    arrive('opened late');
    await late;
    await new Promise((resolve) => setImmediate(resolve));
    expect(onLate).toHaveBeenCalledWith('opened late');
  });
});

describe('readTemplateContent', () => {
  it('reads the stored bytes', async () => {
    const stored = await storeTemplate('template bytes');
    const content = await readTemplateContent(stored, 1024);
    expect(content?.toString()).toBe('template bytes');
  });

  it('is null when storage no longer has the file', async () => {
    const stored = await storeTemplate('gone soon');
    await getStorageAdapter('default').deleteFile(stored.file.backendRef);
    await expect(readTemplateContent(stored, 1024)).resolves.toBeNull();
  });

  it('is null when the bytes exceed the limit', async () => {
    const stored = await storeTemplate('twelve bytes');
    await expect(readTemplateContent(stored, 11)).resolves.toBeNull();
  });
});
