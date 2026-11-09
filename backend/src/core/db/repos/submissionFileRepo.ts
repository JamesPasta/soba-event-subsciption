import { eq } from 'drizzle-orm';
import { db, type Tx } from '../client';
import { files, submissionFiles } from '../schema';
import type { FileRecord } from './fileRepo';

export interface SubmissionFileLink {
  fileId: string;
  submissionId: string;
  workspaceId: string;
  createdBy: string;
}

export const linkFileToSubmission = async (tx: Tx, link: SubmissionFileLink): Promise<void> => {
  await tx.insert(submissionFiles).values({
    fileId: link.fileId,
    submissionId: link.submissionId,
    workspaceId: link.workspaceId,
    createdBy: link.createdBy,
  });
};

export const unlinkSubmissionFile = async (tx: Tx, fileId: string): Promise<void> => {
  await tx.delete(submissionFiles).where(eq(submissionFiles.fileId, fileId));
};

/** The file and the submission it is attached to; null when the file has no submission link. */
export const getSubmissionFileByFileId = async (
  fileId: string,
): Promise<{ file: FileRecord; submissionId: string } | null> => {
  const rows = await db
    .select({ file: files, submissionId: submissionFiles.submissionId })
    .from(submissionFiles)
    .innerJoin(files, eq(files.id, submissionFiles.fileId))
    .where(eq(submissionFiles.fileId, fileId))
    .limit(1);
  return rows[0] ?? null;
};
