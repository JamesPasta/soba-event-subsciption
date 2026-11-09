import path from 'node:path';
import type { FilesConfigMetaResponse } from '@soba/lib';
import { env } from '../../core/config/env';

/**
 * Extensions rejected on upload regardless of a form's fileTypes. Enforced server-side; also sent
 * to the client via GET /meta/files-config so it can block them before upload.
 */
export const BLOCKED_FILE_EXTENSIONS: readonly string[] = [
  '.exe',
  '.bat',
  '.scr',
  '.com',
  '.pif',
  '.cmd',
  '.jar',
  '.app',
  '.deb',
  '.dmg',
  '.msi',
  '.run',
  '.bin',
  '.sh',
  '.ps1',
  '.vbs',
  '.js',
  '.html',
  '.php',
  '.py',
  '.rb',
];

/**
 * Client-facing files config: the upload size limit (mirrors the multer limit, from
 * FILES_MAX_FILE_SIZE_MB) and the extensions blocked regardless of a form's fileTypes.
 */
export function getFilesConfig(): FilesConfigMetaResponse {
  return {
    maxFileSizeMb: env.getFilesMaxFileSizeMb(),
    blockedExtensions: [...BLOCKED_FILE_EXTENSIONS],
  };
}

/** True when the filename's extension is on the always-blocked list (case-insensitive). */
export function isBlockedExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext !== '' && BLOCKED_FILE_EXTENSIONS.includes(ext);
}
