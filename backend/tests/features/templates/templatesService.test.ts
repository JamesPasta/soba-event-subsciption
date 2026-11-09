/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import os from 'os';
import path from 'path';

// In-memory file and document_template rows so the service can be exercised without a database.
const mockFiles = new Map<string, any>();
const mockTemplates = new Map<string, any>();
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
    releaseFileRow: jest.fn(async (_tx: unknown, record: any, isLinked: any) => {
      if (await isLinked(mockTx, record)) return false;
      mockFiles.delete(record.id);
      return true;
    }),
    releaseFileRecord: jest.fn(async (record: any, unlink: any, isLinked: any) => {
      await unlink(mockTx, record);
      if (await isLinked(mockTx, record)) return false;
      mockFiles.delete(record.id);
      return true;
    }),
  };
});
jest.mock('../../../src/core/db/repos/documentTemplateRepo', () => {
  const withFile = (template: any) =>
    template ? { template, file: mockFiles.get(template.fileId), formVersionNo: 1 } : null;
  // Mirrors the conditional writes: only while the template still holds the expected file.
  const holds = (id: string, fileId: string) => mockTemplates.get(id)?.fileId === fileId;
  return {
    insertDocumentTemplate: jest.fn(async (_tx: unknown, input: any) => {
      const clash = [...mockTemplates.values()].some(
        (t) => t.formVersionId === input.formVersionId && t.type === input.type,
      );
      // The shape pg reports a unique violation in.
      if (clash) {
        throw Object.assign(new Error('duplicate'), {
          code: '23505',
          severity: 'ERROR',
          constraint: 'document_template_version_type_uq',
        });
      }
      mockTemplates.set(input.id, {
        ...input,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }),
    setDocumentTemplateFile: jest.fn(
      async (_tx: unknown, id: string, fromFileId: string, toFileId: string) => {
        if (!holds(id, fromFileId)) return false;
        mockTemplates.get(id).fileId = toFileId;
        return true;
      },
    ),
    renameDocumentTemplate: jest.fn(async (id: string, name: string) => {
      const template = mockTemplates.get(id);
      if (template) template.name = name;
      return template ?? null;
    }),
    deleteDocumentTemplate: jest.fn(async (_tx: unknown, id: string, fileId: string) => {
      if (!holds(id, fileId)) return false;
      mockTemplates.delete(id);
      return true;
    }),
    hasDocumentTemplateForFile: jest.fn(async (_tx: unknown, fileId: string) =>
      [...mockTemplates.values()].some((t) => t.fileId === fileId),
    ),
    getDocumentTemplate: jest.fn(async (id: string) => withFile(mockTemplates.get(id))),
    listFormDocumentTemplates: jest.fn(async (formId: string) =>
      [...mockTemplates.values()].filter((t) => t.formId === formId).map(withFile),
    ),
  };
});
// Antivirus off: scanning has its own tests.
jest.mock('../../../src/core/db/repos/featureRepo', () => ({
  isFeatureEnabledCached: jest.fn().mockResolvedValue(false),
}));

import { templatesService } from '../../../src/features/templates/service';
import { ConflictError } from '../../../src/core/errors';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'templates-svc-'));
process.env.STORAGE_PROFILES = 'default';
process.env.TEMPLATES_STORAGE_PROFILE = 'default';
process.env.STORAGE_PROFILE_DEFAULT_BACKEND = 'storage-local';
process.env.STORAGE_PROFILE_DEFAULT_BASE_PATH = tmp;

const actor = { workspaceId: 'ws1', actorId: 'actor1' };
const version = (id: string) => ({ id, formId: 'form1' });
const cdogs = (name: string) => ({ type: 'cdogs' as const, name });

const upload = (filename: string, body: string) => ({
  filename,
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: body.length,
  buffer: Buffer.from(body),
});

/** Create a template that must exist. */
async function createTemplate(versionId: string, name: string, filename: string, body: string) {
  const created = await templatesService.create(
    actor,
    version(versionId),
    cdogs(name),
    upload(filename, body),
  );
  if (!created) throw new Error('expected the template to be created');
  return created;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** Every stored blob under the temp backend. */
function listBlobs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listBlobs(full));
    else out.push(full);
  }
  return out.sort();
}

/** The template a new draft of `toVersionId` gets: same name, same file. */
async function carryForward(source: { template: { id: string } }, toVersionId: string) {
  const id = `${source.template.id}-${toVersionId}`;
  mockTemplates.set(id, {
    ...mockTemplates.get(source.template.id),
    id,
    formVersionId: toVersionId,
  });
  const carried = await templatesService.get(id);
  if (!carried) throw new Error('expected the carried template');
  return carried;
}

async function contentOf(templateId: string): Promise<string> {
  const template = await templatesService.get(templateId);
  const file = template && (await templatesService.open(template));
  if (!file?.downloadStream) throw new Error('expected a stored template file');
  return readAll(file.downloadStream);
}

describe('templatesService', () => {
  beforeEach(() => {
    mockTemplates.clear();
  });

  it('stores a template on its form version and lists it with the form', async () => {
    const created = await createTemplate('v1', 'Receipt', 'r.docx', 'one');
    expect(created.template).toEqual(
      expect.objectContaining({
        formId: 'form1',
        formVersionId: 'v1',
        type: 'cdogs',
        name: 'Receipt',
      }),
    );
    expect(created.file.filename).toBe('r.docx');
    expect(await contentOf(created.template.id)).toBe('one');

    expect(created.file.backendRef).toMatch(/^local:templates\/ws1\//);

    await createTemplate('v2', 'Receipt', 'r.docx', 'other version');
    const onForm = await templatesService.list('form1');
    expect(onForm.map((t) => t.template.formVersionId).sort()).toEqual(['v1', 'v2']);
  });

  it('refuses a second template of a type on a version, leaving no stored file', async () => {
    await createTemplate('v1', 'Receipt', 'r.docx', 'one');
    const before = listBlobs(tmp);
    await expect(
      templatesService.create(actor, version('v1'), cdogs('Other'), upload('r2.docx', 'two')),
    ).rejects.toThrow(new ConflictError('The form version already has a template of this type'));
    expect(listBlobs(tmp)).toEqual(before);
  });

  it('replaces the file under the same template id and removes the old file', async () => {
    const created = await createTemplate('v1', 'Receipt', 'a.docx', 'old');
    const oldFileId = created.file.id;
    const blobsBefore = listBlobs(tmp);

    const replaced = await templatesService.replaceFile(created, actor, upload('b.docx', 'new'));

    expect(replaced?.template.id).toBe(created.template.id);
    expect(replaced?.file.filename).toBe('b.docx');
    expect(await contentOf(created.template.id)).toBe('new');
    expect(mockFiles.has(oldFileId)).toBe(false);
    expect(listBlobs(tmp)).toHaveLength(blobsBefore.length);
  });

  it('refuses a replace made from a stale template, leaving no new file', async () => {
    const created = await createTemplate('v1', 'Receipt', 'a.docx', 'old');
    await templatesService.replaceFile(created, actor, upload('b.docx', 'first'));
    const blobs = listBlobs(tmp);
    await expect(
      templatesService.replaceFile(created, actor, upload('c.docx', 'second')),
    ).rejects.toThrow(ConflictError);
    expect(listBlobs(tmp)).toEqual(blobs);
    expect(await contentOf(created.template.id)).toBe('first');
  });

  it('refuses a delete made from a stale template, keeping the template', async () => {
    const created = await createTemplate('v1', 'Receipt', 'a.docx', 'old');
    await templatesService.replaceFile(created, actor, upload('b.docx', 'new'));
    await expect(templatesService.remove(created)).rejects.toThrow(ConflictError);
    expect(await contentOf(created.template.id)).toBe('new');
  });

  it('renames a template', async () => {
    const created = await createTemplate('v1', 'Receipt', 'r.docx', 'one');
    const renamed = await templatesService.rename(created.template.id, 'Summary', 'actor2');
    expect(renamed?.template.name).toBe('Summary');
    expect(await templatesService.rename('missing', 'Summary', 'actor2')).toBeNull();
  });

  it('keeps a file another version still uses when a template is deleted, until the last goes', async () => {
    const created = await createTemplate('v1', 'Receipt', 'r.docx', 'one');
    const carried = await carryForward(created, 'v2');
    const blobs = listBlobs(tmp);

    await templatesService.remove(created);
    expect(mockFiles.has(created.file.id)).toBe(true);
    expect(listBlobs(tmp)).toEqual(blobs);
    expect(await contentOf(carried.template.id)).toBe('one');

    await templatesService.remove(carried);
    expect(mockFiles.has(created.file.id)).toBe(false);
    expect(listBlobs(tmp)).toHaveLength(blobs.length - 1);
  });

  it('gives a replaced template its own file, leaving the shared one with the other version', async () => {
    const created = await createTemplate('v1', 'Receipt', 'a.docx', 'one');
    const carried = await carryForward(created, 'v2');

    await templatesService.replaceFile(carried, actor, upload('b.docx', 'new'));

    expect(await contentOf(carried.template.id)).toBe('new');
    expect(await contentOf(created.template.id)).toBe('one');
    expect(mockFiles.has(created.file.id)).toBe(true);
  });

  it('removes the template, its file row and the stored file', async () => {
    const created = await createTemplate('v1', 'Receipt', 'r.docx', 'one');
    const blobsBefore = listBlobs(tmp);
    await templatesService.remove(created);
    expect(await templatesService.get(created.template.id)).toBeNull();
    expect(mockFiles.has(created.file.id)).toBe(false);
    expect(listBlobs(tmp)).toHaveLength(blobsBefore.length - 1);
  });
});
