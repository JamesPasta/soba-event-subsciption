import { z } from 'zod';

/** What a template is for. A form version holds at most one template of each type. */
export const TEMPLATE_TYPES = ['cdogs'] as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[number];

/** The file extensions each template type accepts, lower case and without the dot. */
export const TEMPLATE_TYPE_EXTENSIONS = {
  cdogs: ['docx', 'xlsx', 'html'],
} as const satisfies Record<TemplateType, readonly string[]>;

/** The feature that makes each template type available; new files of a type need it. */
export const TEMPLATE_TYPE_FEATURES = {
  cdogs: 'document-generation',
} as const satisfies Record<TemplateType, string>;

/** A file extension the template type accepts. */
export type TemplateFileType<T extends TemplateType = TemplateType> =
  (typeof TEMPLATE_TYPE_EXTENSIONS)[T][number];

/** The file's extension when the template type accepts it; null otherwise. */
export const templateFileTypeFor = <T extends TemplateType>(
  type: T,
  filename: string,
): TemplateFileType<T> | null => {
  const dot = filename.lastIndexOf('.');
  // No extension, or a dot file such as ".docx".
  if (dot <= 0) return null;
  const extension = filename.slice(dot + 1).toLowerCase();
  const accepted: readonly string[] = TEMPLATE_TYPE_EXTENSIONS[type];
  return accepted.includes(extension) ? (extension as TemplateFileType<T>) : null;
};

/** The extensions a template type accepts, for messages: "docx, xlsx, html". */
export const templateExtensionsText = (type: TemplateType): string =>
  TEMPLATE_TYPE_EXTENSIONS[type].join(', ');

/** `accept` value for a file input that takes a template of the type. */
export const templateFileAccept = (type: TemplateType): string =>
  TEMPLATE_TYPE_EXTENSIONS[type].map((extension) => `.${extension}`).join(',');

export const TEMPLATE_NAME_MAX_LENGTH = 100;

export const TemplateIdParamsSchema = z.object({ id: z.uuid() });

/** Templates are listed for a whole form, across its versions. */
export const TemplatesFormQuerySchema = z.object({ formId: z.uuid() });

/** A template is uploaded to one form version. */
export const TemplateVersionQuerySchema = z.object({ formVersionId: z.uuid() });

export const TemplateNameBodySchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX_LENGTH),
});

/** The server names a template uploaded without a name after its type. */
export const TemplateUploadBodySchema = z.object({
  type: z.enum(TEMPLATE_TYPES),
  name: z.string().trim().max(TEMPLATE_NAME_MAX_LENGTH).optional(),
});

/** A document template: the record's own fields plus those of the file it wraps. */
export const TemplateResponseSchema = z.object({
  id: z.uuid(),
  formId: z.uuid(),
  formVersionId: z.uuid(),
  formVersionNo: z.number().int(),
  type: z.enum(TEMPLATE_TYPES),
  name: z.string(),
  filename: z.string(),
  contentType: z.string().nullable(),
  size: z.number().int().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedBy: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});

export const TemplateListResponseSchema = z.object({ items: z.array(TemplateResponseSchema) });

/** Formats a print can convert the document to. Without one it keeps the template's format. */
export const PRINT_CONVERT_TO = ['pdf'] as const;

export const PRINT_REPORT_NAME_MAX_LENGTH = 255;

// No lone surrogate: the name goes into the download's Content-Disposition, which cannot encode one.
const WELL_FORMED = /^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/;

/** The render options a print accepts. */
export const PrintOptionsSchema = z.strictObject({
  convertTo: z.enum(PRINT_CONVERT_TO).optional(),
  reportName: z
    .string()
    .trim()
    .min(1)
    .max(PRINT_REPORT_NAME_MAX_LENGTH)
    .regex(WELL_FORMED)
    .optional(),
});

/** A print with a template stored on the submission's form version. */
export const PrintBodySchema = z.strictObject({
  templateId: z.uuid(),
  options: PrintOptionsSchema.optional(),
});

/** What a submitter's Print reads: the stored template, if any, and whether a backend can render. */
export const SubmissionPrintFactsSchema = z.object({
  items: z.array(z.object({ id: z.uuid() })),
  renderAvailable: z.boolean(),
});

/** What a staff Print reads: the stored templates, and whether a backend can render. */
export const StaffPrintFactsSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      filename: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  renderAvailable: z.boolean(),
});

export type TemplateIdParams = z.infer<typeof TemplateIdParamsSchema>;
export type TemplatesFormQuery = z.infer<typeof TemplatesFormQuerySchema>;
export type TemplateVersionQuery = z.infer<typeof TemplateVersionQuerySchema>;
export type TemplateNameBody = z.infer<typeof TemplateNameBodySchema>;
export type TemplateUploadBody = z.infer<typeof TemplateUploadBodySchema>;
export type TemplateResponse = z.infer<typeof TemplateResponseSchema>;
export type TemplateListResponse = z.infer<typeof TemplateListResponseSchema>;
export type PrintOptions = z.infer<typeof PrintOptionsSchema>;
export type PrintBody = z.infer<typeof PrintBodySchema>;
export type SubmissionPrintFacts = z.infer<typeof SubmissionPrintFactsSchema>;
export type StaffPrintFacts = z.infer<typeof StaffPrintFactsSchema>;
