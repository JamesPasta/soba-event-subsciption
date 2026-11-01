import { getStorageAdapter } from '../integrations/plugins/PluginRegistry';
import {
  createFileRecord,
  deleteFileRecord,
  releaseFileRecord,
  type FileLinkCheck,
  type FileLinkWrite,
  type FileRecord,
} from '../db/repos/fileRepo';
import type { GetFileResult } from '../integrations/storage-engine/StorageEngineAdapter';
import { isStoragePrefix } from '../integrations/storage-engine/storageKey';
import { scanUpload, type ScanOutcome } from './scanUpload';
import { ApiErrorCodes } from '@soba/lib';
import { ServiceUnavailableError, UnprocessableEntityError } from '../errors';
import { log } from '../logging';

export interface StoreFileInput {
  workspaceId: string;
  actorId: string;
  /** Storage profile of the owning feature. */
  profile: string;
  /** Key prefix of the owning feature. */
  prefix: string;
  filename: string;
  contentType?: string;
  size?: number;
  buffer: Buffer;
}

/** A file the system built itself, streamed from where it was staged. */
export interface StoreGeneratedFileInput {
  workspaceId: string;
  actorId: string;
  profile: string;
  prefix: string;
  filename: string;
  contentType: string;
  size: number;
  stream: NodeJS.ReadableStream;
}

/** The stored file, or the scan outcome that refused it. */
export type StoreFileOutcome = FileRecord | Exclude<ScanOutcome, 'clean'>;

/** The stored file, or the API error for a scan that refused it. */
export function storedOrThrow(outcome: StoreFileOutcome): FileRecord {
  // Infected is a problem with the content; scan-unavailable fails closed, so nothing is stored.
  if (outcome === 'infected') {
    throw new UnprocessableEntityError('File failed virus scan', ApiErrorCodes.file_infected);
  }
  if (outcome === 'scan-unavailable') {
    throw new ServiceUnavailableError('Virus scanning unavailable', ApiErrorCodes.scan_unavailable);
  }
  return outcome;
}

/** Stored files for every feature. */
export const fileStore = {
  /**
   * Scan, store the bytes, then record the file and its link. An infected or unscannable file never
   * reaches storage or the database.
   */
  async put(input: StoreFileInput, link: FileLinkWrite): Promise<StoreFileOutcome> {
    if (!isStoragePrefix(input.prefix)) {
      throw new Error(`Invalid storage prefix '${input.prefix}'`);
    }
    const scan = await scanUpload(input.buffer, input.filename);
    if (scan !== 'clean') return scan;

    const adapter = getStorageAdapter(input.profile);
    const result = await adapter.uploadFile({
      workspaceId: input.workspaceId,
      prefix: input.prefix,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      buffer: input.buffer,
    });
    try {
      return await createFileRecord(
        {
          workspaceId: input.workspaceId,
          profile: input.profile,
          backendRef: result.engineFileRef,
          filename: input.filename,
          contentType: input.contentType ?? null,
          size: input.size ?? null,
          createdBy: input.actorId,
        },
        link,
      );
    } catch (err) {
      // Storage and DB can't share a transaction; drop the stored bytes when the rows fail.
      // deleteFile swallows its own errors.
      await adapter.deleteFile(result.engineFileRef);
      throw err;
    }
  },

  /**
   * Store a file the system generated, then record it and its link. Not scanned: no one uploaded
   * it. A failed upload stores nothing; a failed record write deletes the stored bytes.
   */
  async putGenerated(input: StoreGeneratedFileInput, link: FileLinkWrite): Promise<FileRecord> {
    if (!isStoragePrefix(input.prefix)) {
      throw new Error(`Invalid storage prefix '${input.prefix}'`);
    }
    const adapter = getStorageAdapter(input.profile);
    const result = await adapter.uploadFile({
      workspaceId: input.workspaceId,
      prefix: input.prefix,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      stream: input.stream,
    });
    try {
      return await createFileRecord(
        {
          workspaceId: input.workspaceId,
          profile: input.profile,
          backendRef: result.engineFileRef,
          filename: input.filename,
          contentType: input.contentType,
          size: input.size,
          createdBy: input.actorId,
        },
        link,
      );
    } catch (err) {
      await adapter.deleteFile(result.engineFileRef);
      throw err;
    }
  },

  /** The file's metadata and, when the backend offers one, a download stream. Null when gone. */
  open(record: FileRecord): Promise<GetFileResult | null> {
    return getStorageAdapter(record.profile).getFile(record.backendRef);
  },

  /**
   * Rows first, then bytes: a failed byte delete leaves unreferenced bytes, never a row without
   * bytes.
   */
  async remove(record: FileRecord, unlink: FileLinkWrite): Promise<void> {
    await deleteFileRecord(record, unlink);
    await fileStore.deleteBytes(record);
  },

  /**
   * Remove one link to a shared file, and the file itself once no link remains. Rows first, then
   * bytes.
   */
  async release(record: FileRecord, unlink: FileLinkWrite, isLinked: FileLinkCheck): Promise<void> {
    if (await releaseFileRecord(record, unlink, isLinked)) {
      await fileStore.deleteBytes(record);
    }
  },

  /** Delete a file's stored bytes once its row is gone. Never throws: a failure is logged. */
  async deleteBytes(record: FileRecord): Promise<void> {
    try {
      await getStorageAdapter(record.profile).deleteFile(record.backendRef);
    } catch (err) {
      log.warn({ err, fileId: record.id, profile: record.profile }, 'Stored bytes not deleted');
    }
  },
};
