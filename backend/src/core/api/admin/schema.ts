import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  SobaAdminItemSchema as LibSobaAdminItemSchema,
  SobaAdminSortSchema as LibSobaAdminSortSchema,
  ListSobaAdminsResponseSchema as LibListSobaAdminsResponseSchema,
  FeatureScopeItemSchema as LibFeatureScopeItemSchema,
  FeatureScopeSortSchema as LibFeatureScopeSortSchema,
  ListFeatureScopesResponseSchema as LibListFeatureScopesResponseSchema,
  AddSobaAdminBodySchema as LibAddSobaAdminBodySchema,
  UpsertFeatureScopeBodySchema as LibUpsertFeatureScopeBodySchema,
  DocumentGenerationAuditItemSchema as LibDocumentGenerationAuditItemSchema,
  DocgenAuditSortSchema as LibDocgenAuditSortSchema,
  ListDocumentGenerationAuditsResponseSchema as LibListDocumentGenerationAuditsResponseSchema,
  JobDetailSchema as LibJobDetailSchema,
  JobEmailCountsSchema as LibJobEmailCountsSchema,
  JobProgressSchema as LibJobProgressSchema,
  JobResultSchema as LibJobResultSchema,
  JobListItemSchema as LibJobListItemSchema,
  JobSortSchema as LibJobSortSchema,
  JobStatusSchema as LibJobStatusSchema,
  JobSummarySchema as LibJobSummarySchema,
  JobTypeItemSchema as LibJobTypeItemSchema,
  ListJobTypesResponseSchema as LibListJobTypesResponseSchema,
  ListJobsResponseSchema as LibListJobsResponseSchema,
} from '@soba/lib';
import {
  offsetQueryFields,
  rejectedCursorField,
  searchQueryField,
  OffsetPageSchema,
  OFFSET_DRIFT_NOTE,
  sortLocaleQueryField,
} from '../shared/offsetPagination';

extendZodWithOpenApi(z);

export const SobaAdminItemSchema = LibSobaAdminItemSchema.clone().openapi('Admin_SobaAdminItem');

export const SobaAdminSortSchema = LibSobaAdminSortSchema.clone().openapi('Admin_SobaAdminSort');

export const ListSobaAdminsQuerySchema = z
  .object({
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    source: z.string().trim().min(1).optional(),
    q: searchQueryField.openapi({ description: 'Matches anywhere in the admin display label.' }),
    sort: SobaAdminSortSchema.default('displayLabel:asc'),
    locale: sortLocaleQueryField,
  })
  .openapi('Admin_ListSobaAdminsQuery');

export const DocgenAuditSortSchema =
  LibDocgenAuditSortSchema.clone().openapi('Admin_DocgenAuditSort');

export const ListDocumentGenerationAuditsQuerySchema = z
  .object({
    workspaceId: z.uuid().optional(),
    formId: z.uuid().optional(),
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    sort: DocgenAuditSortSchema.default('createdAt:desc'),
  })
  .refine((value) => !!value.workspaceId || !!value.formId, {
    message: 'At least one of workspaceId or formId is required',
    path: ['workspaceId'],
  })
  .openapi('Admin_ListDocumentGenerationAuditsQuery');

export const ListSobaAdminsResponseSchema = LibListSobaAdminsResponseSchema.extend({
  items: z.array(SobaAdminItemSchema),
  page: OffsetPageSchema,
  sort: SobaAdminSortSchema,
}).openapi('Admin_ListSobaAdminsResponse');

export const DocumentGenerationAuditItemSchema =
  LibDocumentGenerationAuditItemSchema.clone().openapi('Admin_DocumentGenerationAuditItem');

export const ListDocumentGenerationAuditsResponseSchema =
  LibListDocumentGenerationAuditsResponseSchema.extend({
    items: z.array(DocumentGenerationAuditItemSchema),
    page: OffsetPageSchema,
    sort: DocgenAuditSortSchema,
  }).openapi('Admin_ListDocumentGenerationAuditsResponse');

export const FeatureScopeItemSchema =
  LibFeatureScopeItemSchema.clone().openapi('Admin_FeatureScopeItem');

export const FeatureScopeSortSchema =
  LibFeatureScopeSortSchema.clone().openapi('Admin_FeatureScopeSort');

export const ListFeatureScopesQuerySchema = z
  .object({
    featureCode: z.string().min(1).optional(),
    // Comma-separated, because the caller filters to the features this deployment scopes. An
    // absent param is no filter; an empty one is a filter nothing matches.
    featureCodes: z
      .string()
      .max(2048)
      .optional()
      .transform((value) =>
        value === undefined
          ? undefined
          : value
              .split(',')
              .map((code) => code.trim())
              .filter(Boolean),
      ),
    scopeType: z.enum(['workspace', 'form']).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    sort: FeatureScopeSortSchema.default('updatedAt:desc'),
  })
  .openapi('Admin_ListFeatureScopesQuery');

export const ListFeatureScopesResponseSchema = LibListFeatureScopesResponseSchema.extend({
  items: z.array(FeatureScopeItemSchema),
  page: OffsetPageSchema,
  sort: FeatureScopeSortSchema,
}).openapi('Admin_ListFeatureScopesResponse');

export const AddSobaAdminBodySchema =
  LibAddSobaAdminBodySchema.clone().openapi('Admin_AddSobaAdminBody');

export const UpsertFeatureScopeBodySchema = LibUpsertFeatureScopeBodySchema.clone().openapi(
  'Admin_UpsertFeatureScopeBody',
);

export const SobaAdminUserIdParamsSchema = z
  .object({
    userId: z.string().uuid(),
  })
  .openapi('Admin_SobaAdminUserIdParams');

export const FeatureScopeIdParamsSchema = z
  .object({
    featureScopeId: z.uuid(),
  })
  .openapi('Admin_FeatureScopeIdParams');

export const JobStatusSchema = LibJobStatusSchema.clone().openapi('Admin_JobStatus');
export const JobSortSchema = LibJobSortSchema.clone().openapi('Admin_JobSort');

export const ListJobsQuerySchema = z
  .object({
    status: JobStatusSchema.optional(),
    type: z.string().trim().min(1).optional(),
    workspaceId: z.uuid().optional(),
    formId: z.uuid().optional(),
    submissionId: z.uuid().optional(),
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    sort: JobSortSchema.default('createdAt:desc'),
  })
  .openapi('Admin_ListJobsQuery');
export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;

export const JobIdParamsSchema = z.object({ jobId: z.uuid() }).openapi('Admin_JobIdParams');

export const JobListItemSchema = LibJobListItemSchema.extend({ status: JobStatusSchema }).openapi(
  'Admin_JobListItem',
);

export const ListJobsResponseSchema = LibListJobsResponseSchema.extend({
  items: z.array(JobListItemSchema),
  page: OffsetPageSchema,
  sort: JobSortSchema,
}).openapi('Admin_ListJobsResponse');

export const JobSummarySchema = LibJobSummarySchema.extend({ status: JobStatusSchema }).openapi(
  'Admin_JobSummary',
);
export const JobEmailCountsSchema = LibJobEmailCountsSchema.clone().openapi('Admin_JobEmailCounts');
export const JobProgressSchema = LibJobProgressSchema.clone().openapi('Admin_JobProgress');
export const JobResultSchema = LibJobResultSchema.clone().openapi('Admin_JobResult');

// Built on the named list item, so the detail references it rather than repeat its fields.
export const JobDetailSchema = JobListItemSchema.extend({
  ...LibJobDetailSchema.pick({
    revisionId: true,
    startedAt: true,
    createdBy: true,
    lastRequeuedAt: true,
    lastRequeuedBy: true,
    cancelRequestedBy: true,
    optionNames: true,
    recordedActions: true,
    parentJobId: true,
    childrenQueuedAt: true,
  }).shape,
  parent: JobSummarySchema.optional(),
  children: z.array(JobSummarySchema),
  emailCounts: JobEmailCountsSchema.optional(),
  progress: JobProgressSchema.optional(),
  result: JobResultSchema.optional(),
}).openapi('Admin_JobDetail');

export const JobTypeItemSchema = LibJobTypeItemSchema.clone().openapi('Admin_JobTypeItem');
export const ListJobTypesResponseSchema = LibListJobTypesResponseSchema.extend({
  items: z.array(JobTypeItemSchema),
}).openapi('Admin_ListJobTypesResponse');

const TAG = 'core.admin';
const REQUIRES_SOBA_ADMIN = 'Requires soba_admin role';

export const registerAdminOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: '/admin/soba-admins',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: ListSobaAdminsQuerySchema,
    },
    responses: {
      200: {
        description: `List SOBA platform admins with search and offset pagination. ${OFFSET_DRIFT_NOTE}`,
        content: {
          'application/json': {
            schema: ListSobaAdminsResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/soba-admins',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: AddSobaAdminBodySchema,
          },
        },
      },
    },
    responses: {
      204: { description: 'Direct SOBA admin grant added or converted' },
      400: { description: 'Invalid body: userId not a UUID, or no such user' },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/admin/soba-admins/{userId}',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Direct grant removed' },
      400: { description: 'Invalid userId' },
      404: { description: 'No direct grant for that user' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/feature-scopes',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: ListFeatureScopesQuerySchema,
    },
    responses: {
      200: {
        description: 'List feature scope grants',
        content: {
          'application/json': {
            schema: ListFeatureScopesResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query' },
      403: { description: REQUIRES_SOBA_ADMIN },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/feature-scopes/{featureScopeId}',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: FeatureScopeIdParamsSchema,
    },
    responses: {
      200: {
        description: 'Read a feature scope grant',
        content: {
          'application/json': {
            schema: FeatureScopeItemSchema,
          },
        },
      },
      400: { description: 'Invalid featureScopeId' },
      403: { description: REQUIRES_SOBA_ADMIN },
      404: { description: 'Feature scope not found' },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/admin/feature-scopes/{featureScopeId}',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: FeatureScopeIdParamsSchema,
    },
    responses: {
      204: { description: 'Feature scope grant deleted' },
      400: { description: 'Invalid featureScopeId' },
      403: { description: REQUIRES_SOBA_ADMIN },
      404: { description: 'Feature scope not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/feature-scopes',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: UpsertFeatureScopeBodySchema,
          },
        },
      },
    },
    responses: {
      204: {
        description:
          'Feature scope upserted. Creates when missing, otherwise updates existing row status.',
      },
      400: { description: 'Invalid request body, unknown feature code, or feature is not scoped' },
      403: { description: REQUIRES_SOBA_ADMIN },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/document-generation/audits',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: ListDocumentGenerationAuditsQuerySchema,
    },
    responses: {
      200: {
        description: 'Recent document generation audit rows for workspace/form scope',
        content: {
          'application/json': {
            schema: ListDocumentGenerationAuditsResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query (workspaceId/formId/limit)' },
      403: { description: REQUIRES_SOBA_ADMIN },
      404: { description: 'Document generation feature is disabled' },
    },
  });

  registerJobPaths(registry);
};

const INVALID_JOB_ID = 'Invalid jobId';
const JOB_NOT_FOUND = 'Job not found';

const jobResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: JobDetailSchema } },
});

/** The background jobs of every workspace: read, run again, stop. */
const registerJobPaths = (registry: OpenAPIRegistry) => {
  const security = [{ bearerAuth: [] }];
  registry.registerPath({
    method: 'get',
    path: '/admin/jobs',
    tags: [TAG],
    security,
    request: { query: ListJobsQuerySchema },
    responses: {
      200: {
        description:
          'Jobs, newest first unless sorted otherwise. Error text never holds an address.',
        content: { 'application/json': { schema: ListJobsResponseSchema } },
      },
      400: { description: 'Invalid filter, page or sort' },
      403: { description: REQUIRES_SOBA_ADMIN },
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/admin/jobs/types',
    tags: [TAG],
    security,
    responses: {
      200: {
        description: 'The job types this environment runs',
        content: { 'application/json': { schema: ListJobTypesResponseSchema } },
      },
      403: { description: REQUIRES_SOBA_ADMIN },
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/admin/jobs/{jobId}',
    tags: [TAG],
    security,
    request: { params: JobIdParamsSchema },
    responses: {
      200: jobResponse('One job, its related jobs, and for an email job its counts by address'),
      400: { description: INVALID_JOB_ID },
      403: { description: REQUIRES_SOBA_ADMIN },
      404: { description: 'Job not found, or deleted under retention' },
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/admin/jobs/{jobId}/rerun',
    tags: [TAG],
    security,
    request: { params: JobIdParamsSchema },
    responses: {
      200: jobResponse(
        'Queued again as the same job, with the options recorded when it was queued',
      ),
      400: { description: INVALID_JOB_ID },
      403: { description: REQUIRES_SOBA_ADMIN },
      404: { description: JOB_NOT_FOUND },
      409: {
        description:
          'Not dead or cancelled; a type this environment does not run; a submission-received job whose actions were queued; or a last run that may still be finishing',
      },
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/admin/jobs/{jobId}/cancel',
    tags: [TAG],
    security,
    request: { params: JobIdParamsSchema },
    responses: {
      200: jobResponse('Cancelled: the job was queued'),
      202: jobResponse('Stop requested: the job ends at its next heartbeat'),
      400: { description: INVALID_JOB_ID },
      403: { description: REQUIRES_SOBA_ADMIN },
      404: { description: JOB_NOT_FOUND },
      409: { description: 'The job is not queued or running' },
    },
  });
};
