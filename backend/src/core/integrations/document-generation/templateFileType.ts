import { templateFileTypeFor, type TemplateFileType as LibTemplateFileType } from '@soba/lib';

/** The file types the document generation backends render: those a CDOGS template accepts. */
export type TemplateFileType = LibTemplateFileType<'cdogs'>;

/** The render file type of a file name, from its extension; null when a CDOGS template does not accept it. */
export const templateFileType = (filename: string): TemplateFileType | null =>
  templateFileTypeFor('cdogs', filename);
