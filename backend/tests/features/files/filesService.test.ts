/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import os from 'os';
import path from 'path';

// In-memory file and submission_file rows so the service can be exercised without a database.
const mockFiles = new Map<string, any>();
const mockLinks = new Map<string, string>();
const mockTx = {};

jest.mock('../../../src/core/db/repos/fileRepo', () => {
  let seq = 0;
  return {
    createFileRecord: jest.fn(async (input: any, link: any) => {
      const record = {
        id: `file-${++seq}`,
        workspaceId: input.workspaceId,
        profile: input.profile,
        backendRef: input.backendRef,
        filename: input.filename,
        contentType: input.contentType ?? null,
        size: input.size ?? null,
        createdBy: input.createdBy ?? null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await link(mockTx, record);
      mockFiles.set(record.id, record);
      return record;
    }),
    deleteFileRecord: jest.fn(async (record: any, unlink: any) => {
      await unlink(mockTx, record);
      mockFiles.delete(record.id);
    }),
  };
});
jest.mock('../../../src/core/db/repos/submissionFileRepo', () => ({
  linkFileToSubmission: jest.fn(async (_tx: unknown, link: any) => {
    mockLinks.set(link.fileId, link.submissionId);
  }),
  unlinkSubmissionFile: jest.fn(async (_tx: unknown, fileId: string) => {
    mockLinks.delete(fileId);
  }),
  getSubmissionFileByFileId: jest.fn(async (fileId: string) => {
    const file = mockFiles.get(fileId);
    const submissionId = mockLinks.get(fileId);
    return file && submissionId ? { file, submissionId } : null;
  }),
}));

// The authorization read is mocked; the storage + service logic is exercised for real.
jest.mock('../../../src/core/db/repos/submitterSubmissionRepo', () => ({
  findSubmitterSubmission: jest.fn(),
}));
// When the current revision request was made; null when the submission is not revising.
const mockFindRevisionStartedAt = jest.fn();
jest.mock('../../../src/core/db/repos/submissionReviewRepo', () => ({
  findRevisionStartedAt: (...args: unknown[]) => mockFindRevisionStartedAt(...args),
}));
// Antivirus off here: these cases predate scanning and cover storage + authorization.
jest.mock('../../../src/core/db/repos/featureRepo', () => ({
  isFeatureEnabledCached: jest.fn().mockResolvedValue(false),
}));

import { filesService } from '../../../src/features/files/service';
import { createFileRecord, deleteFileRecord } from '../../../src/core/db/repos/fileRepo';
import { linkFileToSubmission } from '../../../src/core/db/repos/submissionFileRepo';
import { findSubmitterSubmission } from '../../../src/core/db/repos/submitterSubmissionRepo';
import { storedSubmission } from '../../core/api/submit/storedSubmission';
import { getStorageAdapter } from '../../../src/core/integrations/plugins/PluginRegistry';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'files-svc-'));
process.env.STORAGE_PROFILES = 'default';
process.env.FILES_STORAGE_PROFILE = 'default';
process.env.STORAGE_PROFILE_DEFAULT_BACKEND = 'storage-local';
process.env.STORAGE_PROFILE_DEFAULT_BASE_PATH = tmp;

/** The submission's workspace and state as the one read finds it; null when it is not live. */
const submissionMock = jest.fn();
const readMock = jest.mocked(findSubmitterSubmission);

const owner = { actorId: 'actor1', idpCode: 'idir' };
const intruder = { actorId: 'intruder', idpCode: 'idir' };

let held: string[] = [];
/** Grants the caller exactly the listed form permissions. */
const holding = (codes: string[]) => {
  held = codes;
};

/** The one read: live when the submission is, a grant for the owner only, the held permissions. */
const readAsStored = async (input: { submissionId: string; actorId: string }) => {
  const live = await submissionMock(input.submissionId);
  if (!live) return null;
  const stored = storedSubmission({
    role: input.actorId === owner.actorId ? 'owner' : null,
    workflowState: live.workflowState,
    form: { permissions: held },
  });
  return {
    ...stored,
    submission: { ...stored.submission, id: input.submissionId, workspaceId: live.workspaceId },
  };
};

// upload() returns a discriminated union once antivirus can reject; with the feature off here it is
// always a record. Narrow so the download/delete cases can read the id.
async function uploadRecord(params: Parameters<typeof filesService.upload>[0]) {
  const result = await filesService.upload(params);
  if (typeof result === 'string') throw new Error(`unexpected scan outcome: ${result}`);
  return result;
}

const uploadFor = (submissionId: string, filename = 'a.txt') =>
  uploadRecord({
    workspaceId: 'ws1',
    actorId: 'actor1',
    filename,
    contentType: 'text/plain',
    size: 3,
    buffer: Buffer.from('abc'),
    submissionId,
  });

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** Every stored blob under the temp backend, so a test can assert nothing was orphaned/left behind. */
function listBlobs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listBlobs(full));
    else out.push(full);
  }
  return out.sort();
}

describe('filesService', () => {
  beforeEach(() => {
    held = [];
    submissionMock.mockReset();
    readMock.mockReset();
    readMock.mockImplementation(readAsStored);
  });

  it('a participant downloads, and deletes an un-submitted attachment', async () => {
    const record = await uploadFor('sub1');
    expect(record.id).toBeTruthy();

    holding(['submission_create']);
    submissionMock.mockResolvedValue({
      workspaceId: 'ws1',
      workflowState: 'draft',
      formId: 'form1',
    });
    const got = await filesService.getForCaller(record.id, owner);
    if (typeof got === 'string' || !got.file.downloadStream) {
      throw new Error('expected a file with a download stream');
    }
    expect(got.record.filename).toBe('a.txt');
    expect(await readAll(got.file.downloadStream)).toBe('abc');

    // Un-submitted: a participant who is still in the submit audience may delete.
    expect(await filesService.deleteForCaller(record.id, owner)).toBe('deleted');
    expect(mockLinks.has(record.id)).toBe(false);

    expect(readMock).toHaveBeenCalledWith({ submissionId: 'sub1', ...owner });
  });

  it('denies download to a caller who is not a participant, even one in the audience', async () => {
    const record = await uploadFor('sub1', 'b.txt');
    submissionMock.mockResolvedValue({
      workspaceId: 'ws1',
      workflowState: 'draft',
      formId: 'form1',
    });
    holding(['submission_create']);
    expect(await filesService.getForCaller(record.id, intruder)).toBe('denied');
  });

  it('returns notfound when the owning submission, its form or its version is gone', async () => {
    const record = await uploadFor('sub1', 'h.txt');
    submissionMock.mockResolvedValue(null);
    holding(['submission_create']);
    expect(await filesService.getForCaller(record.id, owner)).toBe('notfound');
    expect(await filesService.deleteForCaller(record.id, owner)).toBe('notfound');
  });

  it('returns notfound when the owning submission is in another workspace', async () => {
    const record = await uploadFor('sub1', 'w.txt');
    submissionMock.mockResolvedValue({
      workspaceId: 'ws2',
      workflowState: 'draft',
      formId: 'form1',
    });
    holding(['submission_create']);
    expect(await filesService.getForCaller(record.id, owner)).toBe('notfound');
  });

  it('reports a file whose stored bytes are gone as unavailable', async () => {
    const record = await uploadFor('sub1', 'gone.txt');
    await getStorageAdapter(record.profile).deleteFile(record.backendRef);
    holding(['submission_create']);
    submissionMock.mockResolvedValue({
      workspaceId: 'ws1',
      workflowState: 'draft',
      formId: 'form1',
    });
    expect(await filesService.getForCaller(record.id, owner)).toBe('unavailable');
  });

  it('treats a file with no submission link as notfound (submission-scoped)', async () => {
    const record = await uploadFor('sub1', 'c.txt');
    mockLinks.delete(record.id);
    holding(['submission_create']);
    expect(await filesService.getForCaller(record.id, owner)).toBe('notfound');
  });

  it('gives staff a file attached to the submission, with no participant check', async () => {
    const record = await uploadFor('sub1', 'staff.txt');

    const got = await filesService.getForSubmission('ws1', 'sub1', record.id);
    if (typeof got === 'string' || !got.file.downloadStream) {
      throw new Error('expected a file with a download stream');
    }
    expect(await readAll(got.file.downloadStream)).toBe('abc');
    expect(readMock).not.toHaveBeenCalled();
  });

  it('refuses staff a file of another submission or another workspace', async () => {
    const record = await uploadFor('sub1', 'other.txt');

    expect(await filesService.getForSubmission('ws1', 'sub2', record.id)).toBe('notfound');
    expect(await filesService.getForSubmission('ws2', 'sub1', record.id)).toBe('notfound');
    expect(await filesService.getForSubmission('ws1', 'sub1', 'no-such-file')).toBe('notfound');
  });

  it('lets only a participant delete an un-submitted attachment', async () => {
    const record = await uploadFor('sub1', 'd.txt');
    submissionMock.mockResolvedValue({
      workspaceId: 'ws1',
      workflowState: 'draft',
      formId: 'form1',
    });
    holding(['submission_create']);
    expect(await filesService.deleteForCaller(record.id, intruder)).toBe('denied');
  });

  it("refuses a delete on a submitted submission's file to a participant holding only submission_create", async () => {
    const record = await uploadFor('sub1', 'e.txt');
    submissionMock.mockResolvedValue({
      workspaceId: 'ws1',
      workflowState: 'submitted',
      formId: 'form1',
    });
    holding(['submission_create']);
    expect(await filesService.deleteForCaller(record.id, owner)).toBe('denied');
  });

  it("lets a non-participant with submission_update delete a submitted submission's file", async () => {
    const record = await uploadFor('sub1', 'e2.txt');
    submissionMock.mockResolvedValue({
      workspaceId: 'ws1',
      workflowState: 'submitted',
      formId: 'form1',
    });
    holding(['submission_update']);
    expect(await filesService.deleteForCaller(record.id, intruder)).toBe('deleted');
    expect(readMock).toHaveBeenCalledWith({ submissionId: 'sub1', ...intruder });
  });

  it('a participant no longer in the submit audience cannot delete', async () => {
    const record = await uploadFor('sub1', 'f.txt');
    submissionMock.mockResolvedValue({
      workspaceId: 'ws1',
      workflowState: 'draft',
      formId: 'form1',
    });
    holding([]);
    expect(await filesService.deleteForCaller(record.id, owner)).toBe('denied');
  });

  it('delete of a file with no submission link is notfound', async () => {
    const record = await uploadFor('sub1', 'g.txt');
    mockLinks.delete(record.id);
    expect(await filesService.deleteForCaller(record.id, owner)).toBe('notfound');
  });

  it('stores attachments under the files prefix, or FILES_STORAGE_PREFIX when set', async () => {
    const before = new Set(listBlobs(tmp));
    await uploadFor('sub1', 'default-prefix.txt');
    process.env.FILES_STORAGE_PREFIX = 'other-prefix';
    try {
      await uploadFor('sub1', 'override-prefix.txt');
    } finally {
      delete process.env.FILES_STORAGE_PREFIX;
    }
    const folders = listBlobs(tmp)
      .filter((blob) => !before.has(blob))
      .map((blob) => path.relative(tmp, path.dirname(blob)));
    expect(folders.sort()).toEqual([
      path.join('attachments', 'ws1'),
      path.join('other-prefix', 'ws1'),
    ]);
  });

  it('refuses a storage prefix outside the allowed pattern before storing anything', async () => {
    const before = listBlobs(tmp);
    process.env.FILES_STORAGE_PREFIX = '../escape';
    try {
      await expect(uploadFor('sub1', 'escape.txt')).rejects.toThrow(
        "Invalid storage prefix '../escape'",
      );
    } finally {
      delete process.env.FILES_STORAGE_PREFIX;
    }
    expect(listBlobs(tmp)).toEqual(before);
  });

  it('removes the stored blob when the file-record insert fails (no orphan)', async () => {
    const before = listBlobs(tmp);
    (createFileRecord as jest.Mock).mockRejectedValueOnce(new Error('insert failed'));
    await expect(uploadFor('sub1', 'orphan.txt')).rejects.toThrow('insert failed');
    expect(listBlobs(tmp)).toEqual(before);
  });

  it('removes the stored blob when the submission link insert fails (no orphan)', async () => {
    const before = listBlobs(tmp);
    (linkFileToSubmission as jest.Mock).mockRejectedValueOnce(new Error('link failed'));
    await expect(uploadFor('sub1', 'unlinked.txt')).rejects.toThrow('link failed');
    expect(listBlobs(tmp)).toEqual(before);
  });

  // Ending the revision restores the answers from before it, which may hold the file.
  it('only takes a file attached before the revision out of the answers', async () => {
    const record = await uploadFor('sub1', 'before.txt');
    mockFindRevisionStartedAt.mockResolvedValue(new Date(record.createdAt.getTime() + 1000));
    submissionMock.mockResolvedValue({ workspaceId: 'ws1', workflowState: 'revising' });
    holding(['submission_create']);
    const blobs = listBlobs(tmp);

    expect(await filesService.deleteForCaller(record.id, owner)).toBe('deleted');
    expect(mockLinks.get(record.id)).toBe('sub1');
    expect(listBlobs(tmp)).toEqual(blobs);
    expect(mockFindRevisionStartedAt).toHaveBeenCalledWith('ws1', 'sub1');
  });

  // The state was read as revising, and the revision ended before its start was read.
  it('keeps the file when the revision has just ended', async () => {
    const record = await uploadFor('sub1', 'ended.txt');
    mockFindRevisionStartedAt.mockResolvedValue(null);
    submissionMock.mockResolvedValue({ workspaceId: 'ws1', workflowState: 'revising' });
    holding(['submission_create']);

    expect(await filesService.deleteForCaller(record.id, owner)).toBe('deleted');
    expect(mockLinks.get(record.id)).toBe('sub1');
  });

  it('deletes a file attached during the revision', async () => {
    const record = await uploadFor('sub1', 'during.txt');
    mockFindRevisionStartedAt.mockResolvedValue(new Date(record.createdAt.getTime() - 1000));
    submissionMock.mockResolvedValue({ workspaceId: 'ws1', workflowState: 'revising' });
    holding(['submission_create']);

    expect(await filesService.deleteForCaller(record.id, owner)).toBe('deleted');
    expect(mockLinks.has(record.id)).toBe(false);
  });

  it('leaves the blob intact when the row delete fails (row-first ordering)', async () => {
    const record = await uploadFor('sub1', 'keep.txt');
    submissionMock.mockResolvedValue({
      workspaceId: 'ws1',
      workflowState: 'draft',
      formId: 'form1',
    });
    holding(['submission_create']);
    const blobs = listBlobs(tmp);
    (deleteFileRecord as jest.Mock).mockRejectedValueOnce(new Error('row delete failed'));
    await expect(filesService.deleteForCaller(record.id, owner)).rejects.toThrow(
      'row delete failed',
    );
    // Row-first: the throw precedes deleteFile, so the blob is still present (retryable, no orphan).
    expect(listBlobs(tmp)).toEqual(blobs);
  });
});
