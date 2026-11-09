import { eq } from 'drizzle-orm';
import { db, type Tx } from '../client';
import { files } from '../schema';

export type FileRecord = typeof files.$inferSelect;

/** Writes or removes the owning feature's link row, inside the file row's transaction. */
export type FileLinkWrite = (tx: Tx, record: FileRecord) => Promise<void>;

export interface NewFileRecord {
  workspaceId: string;
  profile: string;
  backendRef: string;
  filename: string;
  contentType?: string | null;
  size?: number | null;
  createdBy?: string | null;
}

/** Insert a file row and its owner's link in one transaction. */
export const createFileRecord = (input: NewFileRecord, link: FileLinkWrite): Promise<FileRecord> =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .insert(files)
      .values({
        workspaceId: input.workspaceId,
        profile: input.profile,
        backendRef: input.backendRef,
        filename: input.filename,
        contentType: input.contentType ?? null,
        size: input.size ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    await link(tx, row);
    return row;
  });

/** Whether any of the owning feature's links still point at the file. */
export type FileLinkCheck = (tx: Tx, record: FileRecord) => Promise<boolean>;

/** Delete the owner's link, then the file row, in one transaction. */
export const deleteFileRecord = async (
  record: FileRecord,
  unlink: FileLinkWrite,
): Promise<void> => {
  await db.transaction(async (tx) => {
    await unlink(tx, record);
    await tx.delete(files).where(eq(files.id, record.id));
  });
};

/**
 * Delete the file row when none of the owner's links remain, in the caller's transaction. True when
 * this call deletes the row.
 */
export const releaseFileRow = async (
  tx: Tx,
  record: FileRecord,
  isLinked: FileLinkCheck,
): Promise<boolean> => {
  // The file lock makes concurrent releases of one file count its links one at a time.
  await tx.select({ id: files.id }).from(files).where(eq(files.id, record.id)).for('update');
  if (await isLinked(tx, record)) return false;
  const deleted = await tx.delete(files).where(eq(files.id, record.id)).returning({ id: files.id });
  return deleted.length > 0;
};

/**
 * Delete the owner's link, then the file row when no link remains, in one transaction. True when
 * this call deletes the file row.
 */
export const releaseFileRecord = (
  record: FileRecord,
  unlink: FileLinkWrite,
  isLinked: FileLinkCheck,
): Promise<boolean> =>
  db.transaction(async (tx) => {
    // Link row, then file row: the lock order every path takes.
    await unlink(tx, record);
    return releaseFileRow(tx, record, isLinked);
  });
