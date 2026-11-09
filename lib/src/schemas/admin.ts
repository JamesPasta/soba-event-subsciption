import { z } from 'zod';
import { OffsetPageSchema, makeSortEnum } from './pagination';
import {
  DOCGEN_AUDIT_SORT_FIELDS,
  FEATURE_SCOPE_SORT_FIELDS,
  SOBA_ADMIN_SORT_FIELDS,
} from '../sort';
import {
  JobEmailCountsSchema,
  JobProgressSchema,
  JobResultSchema,
  JobSortSchema,
  JobStatusSchema,
  JobSummarySchema,
} from './jobs';

export const SobaAdminSortSchema = makeSortEnum(SOBA_ADMIN_SORT_FIELDS);

export const SobaAdminItemSchema = z.object({
  userId: z.string(),
  source: z.string(),
  identityProviderCode: z.string().nullable(),
  syncedAt: z.string().nullable(),
  displayLabel: z.string().nullable(),
});
export type SobaAdminItem = z.infer<typeof SobaAdminItemSchema>;

export const ListSobaAdminsResponseSchema = z.object({
  items: z.array(SobaAdminItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    source: z.string().optional(),
    q: z.string().optional(),
  }),
  sort: SobaAdminSortSchema,
});
export type ListSobaAdminsResponse = z.infer<typeof ListSobaAdminsResponseSchema>;

export const AddSobaAdminBodySchema = z.object({
  userId: z.string().uuid(),
});
export type AddSobaAdminBody = z.infer<typeof AddSobaAdminBodySchema>;

export const FeatureScopeSortSchema = makeSortEnum(FEATURE_SCOPE_SORT_FIELDS);

export const FeatureScopeItemSchema = z.object({
  id: z.string().uuid(),
  featureCode: z.string(),
  scopeType: z.enum(['workspace', 'form']),
  scopeId: z.string().uuid(),
  status: z.enum(['active', 'inactive']),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type FeatureScopeItem = z.infer<typeof FeatureScopeItemSchema>;

export const ListFeatureScopesResponseSchema = z.object({
  items: z.array(FeatureScopeItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    featureCode: z.string().optional(),
    scopeType: z.string().optional(),
    status: z.string().optional(),
  }),
  sort: FeatureScopeSortSchema,
});
export type ListFeatureScopesResponse = z.infer<typeof ListFeatureScopesResponseSchema>;

export const UpsertFeatureScopeBodySchema = z.object({
  featureCode: z.string().min(1),
  scopeType: z.enum(['workspace', 'form']),
  scopeId: z.string().uuid(),
  status: z.enum(['active', 'inactive']).optional(),
});
export type UpsertFeatureScopeBody = z.infer<typeof UpsertFeatureScopeBodySchema>;

export const DocgenAuditSortSchema = makeSortEnum(DOCGEN_AUDIT_SORT_FIELDS);

export const DocumentGenerationAuditItemSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  formId: z.string().uuid(),
  submissionId: z.string().uuid(),
  mode: z.string(),
  backendCode: z.string(),
  outcome: z.string(),
  httpStatus: z.number().int().nullable(),
  durationMs: z.number().int(),
  errorDetail: z.string().nullable(),
  requestId: z.string().nullable(),
  templateId: z.string().uuid().nullable(),
  templateFileId: z.string().uuid().nullable(),
  revisionId: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
});
export type DocumentGenerationAuditItem = z.infer<typeof DocumentGenerationAuditItemSchema>;

export const ListDocumentGenerationAuditsResponseSchema = z.object({
  items: z.array(DocumentGenerationAuditItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    workspaceId: z.string().optional(),
    formId: z.string().optional(),
  }),
  sort: DocgenAuditSortSchema,
});
export type ListDocumentGenerationAuditsResponse = z.infer<
  typeof ListDocumentGenerationAuditsResponseSchema
>;

const actor = z.object({ id: z.string().uuid(), displayLabel: z.string().nullable() });

/** A job as the admin list shows it. `lastError` never holds an address. */
export const JobListItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: JobStatusSchema,
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  formId: z.string().uuid().nullable(),
  formName: z.string().nullable(),
  submissionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  runAfter: z.string(),
  finishedAt: z.string().nullable(),
  cancelRequestedAt: z.string().nullable(),
  requeueCount: z.number().int(),
  lastError: z.string().nullable(),
});
export type JobListItem = z.infer<typeof JobListItemSchema>;

export const ListJobsResponseSchema = z.object({
  items: z.array(JobListItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    status: JobStatusSchema.optional(),
    type: z.string().optional(),
    workspaceId: z.string().optional(),
    formId: z.string().optional(),
    submissionId: z.string().optional(),
  }),
  sort: JobSortSchema,
});
export type ListJobsResponse = z.infer<typeof ListJobsResponseSchema>;

/** One job with its relations. Options are named, never shown. */
export const JobDetailSchema = JobListItemSchema.extend({
  revisionId: z.string().uuid().nullable(),
  startedAt: z.string().nullable(),
  createdBy: actor,
  lastRequeuedAt: z.string().nullable(),
  lastRequeuedBy: actor.nullable(),
  cancelRequestedBy: actor.nullable(),
  /** The option names an action job runs with. */
  optionNames: z.array(z.string()),
  /** The action codes a submission-received job recorded. */
  recordedActions: z.array(z.string()),
  parentJobId: z.string().uuid().nullable(),
  /** When the job queued its children, which stays set after they are deleted. */
  childrenQueuedAt: z.string().nullable(),
  /** Absent when the job has none, or it is no longer kept. */
  parent: JobSummarySchema.optional(),
  children: z.array(JobSummarySchema),
  /** Present for a job that sends emails to a list of addresses. */
  emailCounts: JobEmailCountsSchema.optional(),
  /** Present once the job has reported progress. */
  progress: JobProgressSchema.optional(),
  /** Present for a succeeded job that produced a file. Never downloadable here. */
  result: JobResultSchema.optional(),
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

/** A job type this environment runs, with its name. */
export const JobTypeItemSchema = z.object({ type: z.string(), name: z.string() });
export type JobTypeItem = z.infer<typeof JobTypeItemSchema>;

export const ListJobTypesResponseSchema = z.object({ items: z.array(JobTypeItemSchema) });
export type ListJobTypesResponse = z.infer<typeof ListJobTypesResponseSchema>;
