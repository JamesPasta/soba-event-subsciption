import { z } from 'zod';
import { LookupMetaSchema, OffsetPageSchema, makeSortEnum } from './pagination';
import { FORM_SORT_FIELDS, FORM_VERSION_SORT_FIELDS, MY_FORM_SORT_FIELDS } from '../sort';
import { AUDIENCE_MODES, FormAudienceChoiceSchema } from './formSettings/audience';

/** Settings a new form starts with instead of inheriting its workspace's. A group left out inherits. */
export const CreateFormSettingsSchema = z.strictObject({
  audience: FormAudienceChoiceSchema.optional(),
});
export type CreateFormSettings = z.infer<typeof CreateFormSettingsSchema>;

/** Refuses keys it does not know, so a choice the create would not apply is never dropped silently. */
export const CreateFormBodySchema = z
  .strictObject({
    /**
     * Minted by the caller, so a retried create returns the form the first one made. Lowercased, as
     * Postgres returns it, so a retry matches the stored id.
     */
    id: z.uuidv7().toLowerCase().optional(),
    /** Minted by the caller for the form's first version. */
    versionId: z.uuidv7().toLowerCase().optional(),
    workspaceId: z.string().min(1),
    name: z.string().trim().min(1),
    description: z.string().optional(),
    formEngineCode: z.string().trim().min(1).optional(),
    /** The first version's schema; the default form when absent. */
    schema: z.record(z.string(), z.unknown()).optional(),
    settings: CreateFormSettingsSchema.optional(),
  })
  // A retry is matched on both, so they are minted and sent together.
  .refine((body) => (body.id === undefined) === (body.versionId === undefined), {
    message: 'id and versionId are sent together',
    path: ['versionId'],
  });

export const UpdateFormBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.string().trim().min(1).optional(),
  org: z.string().trim().min(1).optional(),
  useCase: z.string().trim().min(1).optional(),
});

export const FormListItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  name: z.string(),
  org: z.string(),
  useCase: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

export const FormResponseSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  org: z.string(),
  useCase: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const FormVersionResponseSchema = z.object({
  id: z.string(),
  formId: z.string(),
  versionNo: z.number().int(),
  state: z.string(),
  engineSyncStatus: z.string(),
  engineSchemaRef: z.string().nullable(),
  currentRevisionNo: z.number().int(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const FormWithVersionResponseSchema = FormResponseSchema.extend({
  formVersion: FormVersionResponseSchema.nullable(),
});

export const FormVersionSummarySchema = z.object({
  id: z.string(),
  versionNo: z.number().int(),
  state: z.string(),
});

export const FormWithPermissionsResponseSchema = FormResponseSchema.extend({
  permissions: z.array(z.string()),
  /** The highest-numbered version that is not deleted. Save and publish target this one. */
  currentVersion: FormVersionSummarySchema.nullable(),
});

export const FormVersionListItemSchema = z.object({
  id: z.string(),
  formId: z.string(),
  versionNo: z.number().int(),
  state: z.string(),
  engineSyncStatus: z.string(),
  engineSchemaRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

export type CreateFormBody = z.infer<typeof CreateFormBodySchema>;
export type UpdateFormBody = z.infer<typeof UpdateFormBodySchema>;
export type FormListItem = z.infer<typeof FormListItemSchema>;
export type FormResponse = z.infer<typeof FormResponseSchema>;
export type FormVersionResponse = z.infer<typeof FormVersionResponseSchema>;
export type FormWithVersionResponse = z.infer<typeof FormWithVersionResponseSchema>;
export type FormVersionSummary = z.infer<typeof FormVersionSummarySchema>;
export type FormWithPermissionsResponse = z.infer<typeof FormWithPermissionsResponseSchema>;
export type FormVersionListItem = z.infer<typeof FormVersionListItemSchema>;

export const FormSortSchema = makeSortEnum(FORM_SORT_FIELDS);

export const ListFormsResponseSchema = z.object({
  items: z.array(FormListItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    workspaceId: z.string().optional(),
    formId: z.string().optional(),
    q: z.string().optional(),
    status: z.string().optional(),
  }),
  sort: FormSortSchema,
});

export type ListFormsResponse = z.infer<typeof ListFormsResponseSchema>;

/** What the submitter rules in @soba/lib read about one form, for one caller. */
export const SubmitterFormFactsSchema = z.object({
  // Null when the form has no published version.
  publishedVersionId: z.string().nullable(),
  // The caller's permission codes on the form.
  permissions: z.array(z.string()),
  // The form's own audience, or its workspace's when it inherits.
  audienceMode: z.enum(AUDIENCE_MODES).nullable(),
  audienceIdps: z.array(z.string()),
  // The form's own drafts setting, or its workspace's when it inherits.
  allowSubmitterDrafts: z.boolean(),
  // The form's own review setting letting submitters revise, or its workspace's when it inherits.
  allowSubmitterRevision: z.boolean(),
});

/** A form as a submitter sees it: what it is, and its facts. */
export const SubmitterFormSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
  })
  .extend(SubmitterFormFactsSchema.shape);

/** A form the caller holds the submitter role on, or has a draft or submitted submission on. */
export const MyFormListItemSchema = SubmitterFormSchema;

export const MyFormSortSchema = makeSortEnum(MY_FORM_SORT_FIELDS);

export const ListMyFormsResponseSchema = z.object({
  items: z.array(MyFormListItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    workspaceId: z.string().optional(),
    q: z.string().optional(),
  }),
  sort: MyFormSortSchema,
});

export type SubmitterForm = z.infer<typeof SubmitterFormSchema>;
export type MyFormListItem = z.infer<typeof MyFormListItemSchema>;
export type MyFormListSort = z.infer<typeof MyFormSortSchema>;
export type ListMyFormsResponse = z.infer<typeof ListMyFormsResponseSchema>;

export const FormVersionSortSchema = makeSortEnum(FORM_VERSION_SORT_FIELDS);

export const ListFormVersionsResponseSchema = z.object({
  items: z.array(FormVersionListItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    workspaceId: z.string().optional(),
    formId: z.string().optional(),
    formVersionId: z.string().optional(),
    state: z.string().optional(),
  }),
  sort: FormVersionSortSchema,
});

export type ListFormVersionsResponse = z.infer<typeof ListFormVersionsResponseSchema>;

export const FormVersionLookupResponseSchema = LookupMetaSchema.extend({
  items: z.array(FormVersionSummarySchema),
});

export type FormVersionLookupResponse = z.infer<typeof FormVersionLookupResponseSchema>;
