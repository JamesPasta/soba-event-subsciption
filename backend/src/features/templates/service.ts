import { v7 as uuidv7 } from 'uuid';
import { env } from '../../core/config/env';
import {
  deleteDocumentTemplate,
  getDocumentTemplate,
  hasDocumentTemplateForFile,
  insertDocumentTemplate,
  listFormDocumentTemplates,
  renameDocumentTemplate,
  setDocumentTemplateFile,
  type DocumentTemplateWithFile,
  type DocumentTemplateWithVersion,
} from '../../core/db/repos/documentTemplateRepo';
import { releaseFileRow, type FileRecord } from '../../core/db/repos/fileRepo';
import type { Tx } from '../../core/db/client';
import type { DocumentTemplateTypeCode } from '../../core/db/codes';
import { isUniqueViolationOn } from '../../core/db/pgError';
import { DOCUMENT_TEMPLATE_VERSION_TYPE_UNIQUE } from '../../core/db/schema';
import { fileStore, storedOrThrow } from '../../core/services/fileStore';
import type { GetFileResult } from '../../core/integrations/storage-engine/StorageEngineAdapter';
import { ConflictError } from '../../core/errors';

/** Who is acting, and in which workspace. */
export interface TemplateActor {
  workspaceId: string;
  actorId: string;
}

export interface TemplateFile {
  filename: string;
  contentType?: string;
  size?: number;
  buffer: Buffer;
}

const TEMPLATE_CHANGED = 'Template changed while this request ran; reload it and retry';
const TYPE_TAKEN = 'The form version already has a template of this type';

const usedByTemplates = (tx: Tx, record: FileRecord) => hasDocumentTemplateForFile(tx, record.id);

const toStoreInput = (actor: TemplateActor, file: TemplateFile) => ({
  workspaceId: actor.workspaceId,
  actorId: actor.actorId,
  profile: env.getTemplatesStorageProfile(),
  prefix: env.getTemplatesStoragePrefix(),
  ...file,
});

export const templatesService = {
  list(formId: string): Promise<DocumentTemplateWithVersion[]> {
    return listFormDocumentTemplates(formId);
  },

  get(id: string): Promise<DocumentTemplateWithVersion | null> {
    return getDocumentTemplate(id);
  },

  /** The template's file contents; null when the storage backend no longer has it. */
  open(template: DocumentTemplateWithFile): Promise<GetFileResult | null> {
    return fileStore.open(template.file);
  },

  /** Refused with a conflict when the form version already has a template of the type. */
  async create(
    actor: TemplateActor,
    formVersion: { id: string; formId: string },
    template: { type: DocumentTemplateTypeCode; name: string },
    file: TemplateFile,
  ): Promise<DocumentTemplateWithVersion | null> {
    const id = uuidv7();
    try {
      storedOrThrow(
        await fileStore.put(toStoreInput(actor, file), (tx, record) =>
          insertDocumentTemplate(tx, {
            id,
            workspaceId: actor.workspaceId,
            formId: formVersion.formId,
            formVersionId: formVersion.id,
            fileId: record.id,
            type: template.type,
            name: template.name,
            createdBy: actor.actorId,
          }),
        ),
      );
    } catch (err) {
      if (isUniqueViolationOn(err, DOCUMENT_TEMPLATE_VERSION_TYPE_UNIQUE)) {
        throw new ConflictError(TYPE_TAKEN);
      }
      throw err;
    }
    return getDocumentTemplate(id);
  },

  /**
   * Store the new file under the same template id and release the file it replaced, in one
   * transaction; the replaced bytes go after commit.
   */
  async replaceFile(
    existing: DocumentTemplateWithFile,
    actor: TemplateActor,
    file: TemplateFile,
  ): Promise<DocumentTemplateWithVersion | null> {
    const { id } = existing.template;
    let released = false;
    storedOrThrow(
      await fileStore.put(toStoreInput(actor, file), async (tx, record) => {
        if (!(await setDocumentTemplateFile(tx, id, existing.file.id, record.id, actor.actorId))) {
          throw new ConflictError(TEMPLATE_CHANGED);
        }
        // Template row, then file row: the lock order every path takes.
        released = await releaseFileRow(tx, existing.file, usedByTemplates);
      }),
    );
    if (released) await fileStore.deleteBytes(existing.file);
    return getDocumentTemplate(id);
  },

  async rename(
    id: string,
    name: string,
    actorId: string,
  ): Promise<DocumentTemplateWithVersion | null> {
    const renamed = await renameDocumentTemplate(id, name, actorId);
    return renamed ? getDocumentTemplate(id) : null;
  },

  remove(existing: DocumentTemplateWithFile): Promise<void> {
    return fileStore.release(
      existing.file,
      async (tx, record) => {
        if (!(await deleteDocumentTemplate(tx, existing.template.id, record.id))) {
          throw new ConflictError(TEMPLATE_CHANGED);
        }
      },
      usedByTemplates,
    );
  },
};
