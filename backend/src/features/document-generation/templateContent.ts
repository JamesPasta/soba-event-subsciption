import type { Readable } from 'node:stream';
import type { DocumentTemplateWithFile } from '../../core/db/repos/documentTemplateRepo';
import { fileStore } from '../../core/services/fileStore';
import { routeTimeoutMs } from '../../core/http/httpClient';
import { log } from '../../core/logging';

/** Time to open and read a template: a quarter of the route timeout, the rest left to the render. */
const readBudgetMs = (): number => Math.floor(routeTimeoutMs() / 4);

/**
 * The promise's value, or 'timeout' when it has not settled by `deadline` (epoch ms). A value that
 * arrives after the deadline goes to `onLate`.
 */
export async function settleBy<T>(
  promise: Promise<T>,
  deadline: number,
  onLate: (value: T) => void,
): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()));
  });
  try {
    const settled = await Promise.race([promise, expired]);
    if (settled === 'timeout') promise.then(onLate, () => undefined);
    return settled;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A stream's bytes, or why reading stopped: more than `maxBytes`, or not finished within
 * `deadlineMs`. The stream is destroyed when reading stops early.
 */
export async function readWithin(
  stream: Readable,
  maxBytes: number,
  deadlineMs: number,
): Promise<Buffer | 'too-large' | 'timeout'> {
  let timedOut = false;
  const timer = setTimeout(() => {
    if (stream.destroyed) return;
    timedOut = true;
    stream.destroy(new Error('Read deadline passed'));
  }, deadlineMs);
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) return 'too-large';
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (timedOut) return 'timeout';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The template's bytes, read whole for the render request. Null when storage does not have them,
 * opening or reading fails or runs out of time, or they exceed `maxBytes`; each case is logged.
 */
export async function readTemplateContent(
  { template, file }: DocumentTemplateWithFile,
  maxBytes: number,
): Promise<Buffer | null> {
  const context = { templateId: template.id, fileId: file.id, profile: file.profile };
  const deadline = Date.now() + readBudgetMs();
  try {
    const stored = await settleBy(fileStore.open(file), deadline, (late) =>
      late?.downloadStream?.destroy(),
    );
    if (stored === 'timeout') {
      log.warn(context, 'Template content open timed out');
      return null;
    }
    if (!stored?.downloadStream) {
      log.warn(context, 'Template content unavailable');
      return null;
    }
    const read = await readWithin(
      stored.downloadStream,
      maxBytes,
      Math.max(0, deadline - Date.now()),
    );
    if (read === 'too-large') {
      log.warn({ ...context, maxBytes }, 'Template content exceeds the template size limit');
      return null;
    }
    if (read === 'timeout') {
      log.warn(context, 'Template content read timed out');
      return null;
    }
    return read;
  } catch (err) {
    log.warn({ ...context, err }, 'Template content unavailable');
    return null;
  }
}
