import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { FileRecord } from '../../db/repos/fileRepo';
import type { GetFileResult } from '../../integrations/storage-engine/StorageEngineAdapter';
import { InternalError } from '../../errors';
import { log } from '../../logging';
import { contentDisposition } from './contentDisposition';

// Types a browser may show in place.
const INLINE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

// Declared types a stored file keeps, because no browser runs script from them. Any other file is
// served as opaque bytes, whatever type its uploader declared.
const KEPT_TYPES = new Set([
  ...INLINE_TYPES,
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]);

const mediaType = (contentType: string | null | undefined): string =>
  (contentType ?? '').split(';')[0].trim().toLowerCase();

/**
 * Stream a stored file to the response. Any failure closes the response, so it is logged here: a
 * client disconnect at info, a storage failure at error.
 */
export async function streamFile(
  source: NodeJS.ReadableStream,
  res: Response,
  fileId: string,
): Promise<void> {
  try {
    await pipeline(source, res);
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ERR_STREAM_PREMATURE_CLOSE') {
      log.info({ fileId }, 'File download closed by the client');
      return;
    }
    log.error({ err, fileId }, 'File download failed');
  }
}

/**
 * Send a stored file as the response body, or redirect to the backend's public URL for it. A
 * streamed file keeps its type only when no browser runs script from it, shows `inline` only for
 * PDF and PNG, JPEG, GIF and WebP images, is never sniffed, and runs sandboxed if a browser renders
 * it.
 */
export async function sendStoredFile(
  res: Response,
  record: FileRecord,
  file: GetFileResult,
  disposition: 'inline' | 'attachment',
): Promise<void> {
  if (file.downloadStream) {
    const type = mediaType(record.contentType ?? file.contentType);
    const inline = disposition === 'inline' && INLINE_TYPES.has(type);
    res.setHeader('Content-Type', KEPT_TYPES.has(type) ? type : 'application/octet-stream');
    // The stored bytes set the length; a stale record size would misframe the response.
    const size = file.size ?? record.size;
    if (size != null) res.setHeader('Content-Length', String(size));
    res.setHeader(
      'Content-Disposition',
      contentDisposition(inline ? 'inline' : 'attachment', record.filename),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    await streamFile(file.downloadStream, res, record.id);
    return;
  }
  if (file.publicUrl) {
    res.redirect(file.publicUrl);
    return;
  }
  throw new InternalError('no download available');
}
