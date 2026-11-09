import type { Response } from 'express';

/**
 * RFC 5987 Content-Disposition: a sanitized ASCII `filename` fallback plus a UTF-8 `filename*` so
 * modern clients render the real name. Both forms are injection-safe (ASCII strips CR/LF/quotes,
 * filename* is percent-encoded).
 */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  // encodeURIComponent leaves ' ( ) * alone; RFC 5987 needs them encoded.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${(c.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Send an in-memory body as a download that is never sniffed. */
export function sendAttachment(
  res: Response,
  contentType: string,
  filename: string,
  body: string | Buffer,
): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDisposition('attachment', filename));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
}
