import { SubmissionWorkflowState } from '@soba/lib';
import { env } from '../../core/config/env';
import type { FileRecord } from '../../core/db/repos/fileRepo';
import {
  getSubmissionFileByFileId,
  linkFileToSubmission,
  unlinkSubmissionFile,
} from '../../core/db/repos/submissionFileRepo';
import type { CallerIdentity } from '../../core/db/repos/formSubmitAccessRepo';
import { findRevisionStartedAt } from '../../core/db/repos/submissionReviewRepo';
import {
  allowsSubmitterOperation,
  findSubmissionForCaller,
  SubmitterOperation,
} from '../../core/services/submitterAccess';
import { fileStore, type StoreFileOutcome } from '../../core/services/fileStore';
import { log } from '../../core/logging';
import type { GetFileResult } from '../../core/integrations/storage-engine/StorageEngineAdapter';

export interface UploadFileParams {
  workspaceId: string;
  actorId: string;
  submissionId: string;
  filename: string;
  contentType?: string;
  size?: number;
  buffer: Buffer;
}

/**
 * The attachment and the caller's read of its submission; null when either is missing, the
 * submission, its form or its form version is deleted, or the file is in another workspace.
 */
async function findAttachment(id: string, caller: CallerIdentity) {
  const attachment = await getSubmissionFileByFileId(id);
  if (!attachment) return null;
  const loaded = await findSubmissionForCaller(attachment.submissionId, caller);
  if (loaded?.submission.workspaceId !== attachment.file.workspaceId) return null;
  return { record: attachment.file, loaded };
}

type OpenedFile = { record: FileRecord; file: GetFileResult };

/**
 * Whether a file stays stored when its submitters remove it: while revising, a file attached before
 * the revision was asked for may be in the answers from before it, which ending the revision
 * restores. Files are not versioned, so removing one then only takes it out of the answers.
 */
async function keptForRestore(
  record: FileRecord,
  submission: { id: string; workspaceId: string; workflowState: string },
): Promise<boolean> {
  if (submission.workflowState !== SubmissionWorkflowState.revising) return false;
  const since = await findRevisionStartedAt(submission.workspaceId, submission.id);
  // Null when the revision ended after the submission was read; the restored answers may hold it.
  return !since || record.createdAt <= since;
}

/** The file's stored bytes, or 'unavailable'. */
async function openRecord(record: FileRecord): Promise<OpenedFile | 'unavailable'> {
  const file = await fileStore.open(record);
  if (!file) {
    log.warn({ fileId: record.id, profile: record.profile }, 'File content unavailable');
    return 'unavailable';
  }
  return { record, file };
}

export const filesService = {
  /** Store a file attached to a submission. The returned record's id is the public reference. */
  upload(params: UploadFileParams): Promise<StoreFileOutcome> {
    return fileStore.put(
      {
        workspaceId: params.workspaceId,
        actorId: params.actorId,
        profile: env.getFilesStorageProfile(),
        prefix: env.getFilesStoragePrefix(),
        filename: params.filename,
        contentType: params.contentType,
        size: params.size,
        buffer: params.buffer,
      },
      (tx, record) =>
        linkFileToSubmission(tx, {
          fileId: record.id,
          submissionId: params.submissionId,
          workspaceId: params.workspaceId,
          createdBy: params.actorId,
        }),
    );
  },

  /**
   * Fetch a file for a caller, scoped to its owning submission: the file must belong to a still-present
   * submission, and the caller must be allowed to read it. 'notfound' when missing / no live owning
   * submission; 'denied' when unauthorized; 'unavailable' when storage does not have the bytes.
   */
  async getForCaller(
    id: string,
    caller: CallerIdentity,
  ): Promise<OpenedFile | 'notfound' | 'denied' | 'unavailable'> {
    const attachment = await findAttachment(id, caller);
    if (!attachment) return 'notfound';
    const { record, loaded } = attachment;
    if (!allowsSubmitterOperation(SubmitterOperation.read, loaded, caller)) return 'denied';
    return openRecord(record);
  },

  /**
   * A file attached to the submission, for staff. The route's workspaceFromResource has checked the
   * submission is live and in this workspace, and requireFormPermissions the caller's access.
   */
  async getForSubmission(
    workspaceId: string,
    submissionId: string,
    fileId: string,
  ): Promise<OpenedFile | 'notfound' | 'unavailable'> {
    const attachment = await getSubmissionFileByFileId(fileId);
    if (attachment?.submissionId !== submissionId || attachment.file.workspaceId !== workspaceId) {
      return 'notfound';
    }
    return openRecord(attachment.file);
  },

  /**
   * Delete a file per its owning submission: while un-submitted, a caller allowed to write it; once
   * submitted, only a caller with submission_update on the form. 'notfound' when missing; 'denied' when
   * the caller isn't authorized.
   */
  async deleteForCaller(
    id: string,
    caller: CallerIdentity,
  ): Promise<'deleted' | 'notfound' | 'denied'> {
    const attachment = await findAttachment(id, caller);
    if (!attachment) return 'notfound';
    const { record, loaded } = attachment;
    if (!allowsSubmitterOperation(SubmitterOperation.deleteFile, loaded, caller)) return 'denied';
    if (await keptForRestore(record, loaded.submission)) return 'deleted';
    await fileStore.remove(record, (tx) => unlinkSubmissionFile(tx, record.id));
    return 'deleted';
  },
};
