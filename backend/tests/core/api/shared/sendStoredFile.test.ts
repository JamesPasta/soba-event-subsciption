import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import express, { type NextFunction, type Request, type Response } from 'express';
import supertest from 'supertest';
import { asyncHandler } from '../../../../src/core/api/shared/asyncHandler';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';
import { log } from '../../../../src/core/logging';
import { sendStoredFile, streamFile } from '../../../../src/core/api/shared/sendStoredFile';
import type { FileRecord } from '../../../../src/core/db/repos/fileRepo';
import type { GetFileResult } from '../../../../src/core/integrations/storage-engine/StorageEngineAdapter';

interface Served {
  port: number;
  /** Errors that reached the error chain. */
  seen: unknown[];
  close: () => Promise<void>;
}

/** Mounted like a download route: an async handler, then the core error handler. */
async function serve(source: Readable): Promise<Served> {
  const seen: unknown[] = [];
  const app = express();
  app.get(
    '/file',
    asyncHandler(async (_req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      await streamFile(source, res, 'file-1');
    }),
  );
  app.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    seen.push(err);
    next(err);
  });
  app.use(coreErrorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** GET the file; `complete` is false when the connection closed before the body finished. */
function download(
  port: number,
  onFirstData?: () => void,
): Promise<{ body: string; complete: boolean }> {
  return new Promise((resolve) => {
    const req = http.get({ port, path: '/file' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (!body) onFirstData?.();
        body += chunk;
      });
      res.on('error', () => undefined);
      res.on('close', () => resolve({ body, complete: res.complete }));
    });
    req.on('error', () => resolve({ body: '', complete: false }));
  });
}

const storageFailure = () => new Error('storage failed');

function expectLoggedStorageFailure(logError: jest.SpyInstance): void {
  expect(logError).toHaveBeenCalledTimes(1);
  expect(logError).toHaveBeenCalledWith(
    expect.objectContaining({
      fileId: 'file-1',
      err: expect.objectContaining({ message: 'storage failed' }),
    }),
    'File download failed',
  );
}

describe('streamFile', () => {
  let served: Served | undefined;

  afterEach(async () => {
    await served?.close();
    served = undefined;
    jest.restoreAllMocks();
  });

  it('streams the whole file', async () => {
    served = await serve(Readable.from(['ab', 'c']));
    await expect(download(served.port)).resolves.toEqual({ body: 'abc', complete: true });
    expect(served.seen).toEqual([]);
  });

  it('logs a storage error after the first bytes and cuts the response', async () => {
    const logError = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    const source = new Readable({ read() {} });
    source.push('partial');
    served = await serve(source);
    // Fail only once the client holds the first bytes, so headers and data were sent.
    const result = await download(served.port, () => source.destroy(storageFailure()));
    expect(result).toEqual({ body: 'partial', complete: false });
    expectLoggedStorageFailure(logError);
    expect(served.seen).toEqual([]);
  });

  it('logs a storage error before any bytes and cuts the response', async () => {
    const logError = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    const source = new Readable({
      read() {
        this.destroy(storageFailure());
      },
    });
    served = await serve(source);
    await expect(download(served.port)).resolves.toEqual({ body: '', complete: false });
    expectLoggedStorageFailure(logError);
    expect(served.seen).toEqual([]);
  });

  it('destroys the source when the client disconnects, and logs it at info', async () => {
    const logInfo = jest.spyOn(log, 'info').mockImplementation(() => undefined);
    const source = new Readable({
      read() {
        this.push('x'.repeat(16 * 1024));
      },
    });
    const sourceClosed = new Promise((resolve) => source.once('close', resolve));
    served = await serve(source);
    const { port } = served;
    await new Promise<void>((resolve) => {
      const req = http.get({ port, path: '/file' }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', () => undefined);
    });
    await sourceClosed;
    expect(source.destroyed).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(logInfo).toHaveBeenCalledWith(
      { fileId: 'file-1' },
      'File download closed by the client',
    );
    expect(served.seen).toEqual([]);
  });
});

const storedRecord = {
  id: 'file-1',
  filename: 'r\u00e9sum\u00e9.txt',
  contentType: 'text/plain',
  size: 99,
} as FileRecord;

function downloadApp(
  file: GetFileResult,
  record: FileRecord = storedRecord,
  disposition: 'inline' | 'attachment' = 'attachment',
): express.Express {
  const app = express();
  app.get(
    '/file',
    asyncHandler(async (_req, res) => {
      await sendStoredFile(res, record, file, disposition);
    }),
  );
  app.use(coreErrorHandler);
  return app;
}

const streamOf = (body: string): GetFileResult => ({
  engineFileRef: 'ref',
  filename: 'ignored',
  size: body.length,
  downloadStream: Readable.from([body]),
});

describe('sendStoredFile', () => {
  it('sends the bytes as an attachment with the backend length and both filename forms', async () => {
    const res = await supertest(downloadApp(streamOf('abc'))).get('/file');
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc');
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-length']).toBe('3');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="r_sum_.txt"; filename*=UTF-8''${encodeURIComponent('r\u00e9sum\u00e9.txt')}`,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
  });

  it('keeps an Office type on a download', async () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const record = { ...storedRecord, filename: 'report.docx', contentType: docx };
    const res = await supertest(downloadApp(streamOf('docx'), record, 'inline')).get('/file');
    expect(res.headers['content-type']).toBe(docx);
    expect(res.headers['content-disposition']).toMatch(/^attachment; /);
  });

  it('downloads an inline type as an attachment when asked to', async () => {
    const png = { ...storedRecord, filename: 'scan.png', contentType: 'image/png' };
    const res = await supertest(downloadApp(streamOf('png'), png, 'attachment')).get('/file');
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toMatch(/^attachment; /);
  });

  it("percent-encodes ' ( ) * in the UTF-8 filename", async () => {
    const record = { ...storedRecord, filename: "d'\u00e9t\u00e9 (1)*.txt" };
    const res = await supertest(downloadApp(streamOf('x'), record)).get('/file');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="d'_t_ (1)*.txt"; filename*=UTF-8''d%27%C3%A9t%C3%A9%20%281%29%2A.txt`,
    );
  });

  it('shows an allowed type inline with that type', async () => {
    const png = { ...storedRecord, filename: 'scan.png', contentType: 'IMAGE/PNG; charset=x' };
    const res = await supertest(downloadApp(streamOf('png'), png, 'inline')).get('/file');
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toMatch(/^inline; /);
  });

  it.each(['text/html', 'image/svg+xml', 'application/javascript'])(
    'downloads a file declared as %s as opaque bytes, even when asked to show it inline',
    async (declared) => {
      const record = { ...storedRecord, filename: 'photo.png', contentType: declared };
      const res = await supertest(downloadApp(streamOf('<script>'), record, 'inline'))
        .get('/file')
        .buffer(true);
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['content-disposition']).toMatch(/^attachment; /);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    },
  );

  it('redirects to the public URL when the backend has one', async () => {
    const file = { engineFileRef: 'ref', filename: 'x', publicUrl: 'https://store.example/x' };
    const res = await supertest(downloadApp(file)).get('/file');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://store.example/x');
  });

  it('returns 500 when the backend offers neither a stream nor a URL', async () => {
    const res = await supertest(downloadApp({ engineFileRef: 'ref', filename: 'x' })).get('/file');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'no download available' });
  });
});
