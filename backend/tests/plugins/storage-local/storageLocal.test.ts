/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { storagePluginDefinition } from '../../../src/plugins/storage-local';
import type { PluginConfigReader } from '../../../src/core/config/pluginConfig';

function makeConfig(basePath: string): PluginConfigReader {
  return {
    getRequired: (k: string) => {
      if (k === 'BASE_PATH') return basePath;
      throw new Error(`missing ${k}`);
    },
    getOptional: (k: string, d?: string) => {
      if (k === 'BASE_PATH') return basePath;
      return d;
    },
    getBoolean: (_k: string) => false,
    getNumber: (_k: string) => 0,
    getOptionalNumber: (_k: string) => undefined,
    getCsv: (_k: string) => [],
  };
}

describe('storage-local adapter', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-local-test-'));
  const adapter = storagePluginDefinition.createAdapter(makeConfig(tmp));

  it('uploads, gets and deletes a file', async () => {
    const result = await (adapter as any).uploadFile({
      workspaceId: 'w1',
      prefix: 'attachments',
      filename: 'hello.txt',
      buffer: Buffer.from('hello world'),
      contentType: 'text/plain',
    });
    expect(result).toHaveProperty('engineFileRef');
    // Stored under an id alone: the file's name never reaches the path.
    expect(fs.readdirSync(path.join(tmp, 'attachments', 'w1'))).toEqual([
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    ]);
    const meta = await (adapter as any).getFile(result.engineFileRef);
    expect(meta).not.toBeNull();
    expect(meta.filename).toBeDefined();
    // Drain the stream so its file descriptor opens and closes before we delete.
    await new Promise<void>((resolve, reject) => {
      meta.downloadStream.on('end', resolve).on('error', reject).resume();
    });

    await (adapter as any).deleteFile(result.engineFileRef);
    const after = await (adapter as any).getFile(result.engineFileRef);
    expect(after).toBeNull();
  });

  it('rejects a stream that fails part way and leaves no partial file', async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('source failed'));
      },
    });
    await expect(
      (adapter as any).uploadFile({
        workspaceId: 'w2',
        prefix: 'job-results',
        filename: 'export.csv',
        stream: failing,
      }),
    ).rejects.toThrow('source failed');
    expect(fs.readdirSync(path.join(tmp, 'job-results', 'w2'))).toEqual([]);
  });

  it('rejects path-traversal refs that escape basePath', async () => {
    expect(await (adapter as any).getFile('local:../../../etc/passwd')).toBeNull();
    await expect((adapter as any).deleteFile('local:../../../etc/passwd')).resolves.toBeUndefined();
  });
});
