import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db, type Tx } from '../client';
import { documentTemplates, files, formVersions, forms } from '../schema';
import type { DocumentTemplateTypeCode } from '../codes';
import type { FileRecord } from './fileRepo';
import { liveFormVersion } from './liveRows';

export type DocumentTemplateRecord = typeof documentTemplates.$inferSelect;

/** A template with the file it holds. */
export interface DocumentTemplateWithFile {
  template: DocumentTemplateRecord;
  file: FileRecord;
}

/** A template with its file and the number of the form version it is on. */
export interface DocumentTemplateWithVersion extends DocumentTemplateWithFile {
  formVersionNo: number;
}

export interface NewDocumentTemplate {
  id: string;
  workspaceId: string;
  formId: string;
  formVersionId: string;
  fileId: string;
  type: DocumentTemplateTypeCode;
  name: string;
  createdBy: string;
}

const heldBy = (id: string, fileId: string) =>
  and(eq(documentTemplates.id, id), eq(documentTemplates.fileId, fileId));

export const insertDocumentTemplate = async (tx: Tx, input: NewDocumentTemplate): Promise<void> => {
  await tx.insert(documentTemplates).values(input);
};

/** Point the template at a new file; false when it no longer holds `fromFileId`. */
export const setDocumentTemplateFile = async (
  tx: Tx,
  id: string,
  fromFileId: string,
  toFileId: string,
  updatedBy: string,
): Promise<boolean> => {
  const rows = await tx
    .update(documentTemplates)
    .set({ fileId: toFileId, updatedBy, updatedAt: new Date() })
    .where(heldBy(id, fromFileId))
    .returning({ id: documentTemplates.id });
  return rows.length > 0;
};

export const renameDocumentTemplate = async (
  id: string,
  name: string,
  updatedBy: string,
): Promise<DocumentTemplateRecord | null> => {
  const [row] = await db
    .update(documentTemplates)
    .set({ name, updatedBy, updatedAt: new Date() })
    .where(eq(documentTemplates.id, id))
    .returning();
  return row ?? null;
};

/** Delete the template; false when it no longer holds `fileId`. */
export const deleteDocumentTemplate = async (
  tx: Tx,
  id: string,
  fileId: string,
): Promise<boolean> => {
  const rows = await tx
    .delete(documentTemplates)
    .where(heldBy(id, fileId))
    .returning({ id: documentTemplates.id });
  return rows.length > 0;
};

/**
 * Give `toFormVersionId` a template for each template on `fromFormVersionId`, with the same type
 * and name and pointing at the same file.
 */
export const copyDocumentTemplates = async (
  tx: Tx,
  fromFormVersionId: string,
  toFormVersionId: string,
  createdBy: string,
): Promise<void> => {
  // Locked so a concurrent replace or delete of a source template either waits for the copy or is
  // seen by it.
  const sources = await tx
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.formVersionId, fromFormVersionId))
    .for('share');
  if (sources.length === 0) return;
  await tx.insert(documentTemplates).values(
    sources.map((source) => ({
      workspaceId: source.workspaceId,
      formId: source.formId,
      formVersionId: toFormVersionId,
      fileId: source.fileId,
      type: source.type,
      name: source.name,
      createdBy,
    })),
  );
};

/** Whether any template points at the file. */
export const hasDocumentTemplateForFile = async (tx: Tx, fileId: string): Promise<boolean> => {
  const rows = await tx
    .select({ id: documentTemplates.id })
    .from(documentTemplates)
    .where(eq(documentTemplates.fileId, fileId))
    .limit(1);
  return rows.length > 0;
};

const selectWithFile = () =>
  db
    .select({ template: documentTemplates, file: files })
    .from(documentTemplates)
    .innerJoin(files, eq(files.id, documentTemplates.fileId));

const selectWithVersion = () =>
  db
    .select({ template: documentTemplates, file: files, formVersionNo: formVersions.versionNo })
    .from(documentTemplates)
    .innerJoin(files, eq(files.id, documentTemplates.fileId))
    .innerJoin(formVersions, eq(formVersions.id, documentTemplates.formVersionId));

export const getDocumentTemplate = async (
  id: string,
): Promise<DocumentTemplateWithVersion | null> => {
  const rows = await selectWithVersion().where(eq(documentTemplates.id, id)).limit(1);
  return rows[0] ?? null;
};

/** The templates on the form's versions that are not deleted: newest version first, then by type. */
export const listFormDocumentTemplates = (formId: string): Promise<DocumentTemplateWithVersion[]> =>
  selectWithVersion()
    .where(and(eq(documentTemplates.formId, formId), isNull(formVersions.deletedAt)))
    .orderBy(desc(formVersions.versionNo), asc(documentTemplates.type));

const selectWithVersionAndForm = () =>
  selectWithFile()
    .innerJoin(formVersions, eq(formVersions.id, documentTemplates.formVersionId))
    .innerJoin(forms, eq(forms.id, documentTemplates.formId));

/** Of the type on the form version, when neither the version nor its form is deleted. */
const onLiveVersion = (formVersionId: string, type: DocumentTemplateTypeCode) =>
  and(
    eq(documentTemplates.formVersionId, formVersionId),
    eq(documentTemplates.type, type),
    liveFormVersion,
  );

/** The template when it is of the type on the form version and neither is deleted; null otherwise. */
export const getLiveDocumentTemplate = async (
  id: string,
  formVersionId: string,
  type: DocumentTemplateTypeCode,
): Promise<DocumentTemplateWithFile | null> => {
  const rows = await selectWithVersionAndForm()
    .where(and(eq(documentTemplates.id, id), onLiveVersion(formVersionId, type)))
    .limit(1);
  return rows[0] ?? null;
};

/** The form version's templates of the type by name, when neither the version nor its form is deleted. */
export const listLiveDocumentTemplates = (
  formVersionId: string,
  type: DocumentTemplateTypeCode,
): Promise<DocumentTemplateWithFile[]> =>
  selectWithVersionAndForm()
    .where(onLiveVersion(formVersionId, type))
    .orderBy(asc(documentTemplates.name));

/**
 * The workspace and form a template belongs to; null when there is no such template, or its form
 * or form version is deleted.
 */
export const getDocumentTemplateScope = async (
  id: string,
): Promise<{ workspaceId: string; formId: string } | null> => {
  const rows = await db
    .select({ workspaceId: documentTemplates.workspaceId, formId: documentTemplates.formId })
    .from(documentTemplates)
    .innerJoin(formVersions, eq(formVersions.id, documentTemplates.formVersionId))
    .innerJoin(forms, eq(forms.id, documentTemplates.formId))
    .where(and(eq(documentTemplates.id, id), liveFormVersion))
    .limit(1);
  return rows[0] ?? null;
};
