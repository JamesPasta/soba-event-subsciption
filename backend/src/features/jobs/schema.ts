import { extendZodWithOpenApi, type OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  JobEmailCountsSchema as LibJobEmailCountsSchema,
  JobFormItemSchema as LibJobFormItemSchema,
  JobSortSchema as LibJobSortSchema,
  JobStatusSchema as LibJobStatusSchema,
  JobSummarySchema as LibJobSummarySchema,
  ListJobFormsResponseSchema as LibListJobFormsResponseSchema,
  ListStaffJobsResponseSchema as LibListStaffJobsResponseSchema,
  StaffJobDetailSchema as LibStaffJobDetailSchema,
  StaffJobListItemSchema as LibStaffJobListItemSchema,
} from '@soba/lib';
import {
  OffsetPageSchema,
  offsetQueryFields,
  rejectedCursorField,
} from '../../core/api/shared/offsetPagination';

extendZodWithOpenApi(z);

export const JobScopeParamsSchema = z
  .object({ id: z.string().min(1) })
  .openapi('StaffJobs_ScopeParams');

export const JobParamsSchema = z
  .object({ id: z.string().min(1), jobId: z.uuid() })
  .openapi('StaffJobs_JobParams');

const JobStatusSchema = LibJobStatusSchema.clone().openapi('StaffJobs_Status');
const JobSortSchema = LibJobSortSchema.clone().openapi('StaffJobs_Sort');

const listQueryFields = {
  status: JobStatusSchema.optional(),
  type: z.string().trim().min(1).optional(),
  ...offsetQueryFields,
  cursor: rejectedCursorField,
  sort: JobSortSchema.default('createdAt:desc'),
};

export const ListFormJobsQuerySchema = z
  .object(listQueryFields)
  .openapi('StaffJobs_ListFormJobsQuery');
export type ListFormJobsQuery = z.infer<typeof ListFormJobsQuerySchema>;

export const ListWorkspaceJobsQuerySchema = z
  .object({ ...listQueryFields, formId: z.uuid().optional() })
  .openapi('StaffJobs_ListWorkspaceJobsQuery');
export type ListWorkspaceJobsQuery = z.infer<typeof ListWorkspaceJobsQuerySchema>;

const JobListItemSchema = LibStaffJobListItemSchema.extend({ status: JobStatusSchema }).openapi(
  'StaffJobs_ListItem',
);

export const ListJobsResponseSchema = LibListStaffJobsResponseSchema.extend({
  items: z.array(JobListItemSchema),
  page: OffsetPageSchema,
  sort: JobSortSchema,
}).openapi('StaffJobs_ListResponse');

const JobSummarySchema = LibJobSummarySchema.extend({ status: JobStatusSchema }).openapi(
  'StaffJobs_Summary',
);
const JobEmailCountsSchema = LibJobEmailCountsSchema.clone().openapi('StaffJobs_EmailCounts');

// Built on the named list item, so the detail references it rather than repeat its fields. The
// actors stay inline: a nullable use of a named component marks the component itself nullable.
export const JobDetailSchema = JobListItemSchema.extend({
  ...LibStaffJobDetailSchema.pick({
    startedAt: true,
    createdBy: true,
    lastRequeuedAt: true,
    lastRequeuedBy: true,
    cancelRequestedBy: true,
    recordedActions: true,
    parentJobId: true,
    childrenQueuedAt: true,
  }).shape,
  parent: JobSummarySchema.optional(),
  children: z.array(JobSummarySchema),
  emailCounts: JobEmailCountsSchema.optional(),
}).openapi('StaffJobs_Detail');

const JobFormItemSchema = LibJobFormItemSchema.clone().openapi('StaffJobs_FormItem');
export const ListJobFormsResponseSchema = LibListJobFormsResponseSchema.extend({
  items: z.array(JobFormItemSchema),
}).openapi('StaffJobs_ListFormsResponse');

const TAG = 'feature.jobs';
const INVALID_ID = 'Invalid id or jobId';
const NOT_FOUND = 'Job not found, or not one this form or workspace started';

const SCOPES = [
  {
    path: '/design/forms/{id}/jobs',
    who: 'the form',
    query: ListFormJobsQuerySchema,
    forbidden: 'Requires form_update on the form',
  },
  {
    path: '/workspaces/{id}/jobs',
    who: 'the workspace',
    query: ListWorkspaceJobsQuerySchema,
    forbidden: 'Requires the workspace owner role',
  },
] as const;

const jobResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: JobDetailSchema } },
});

/** The jobs a form's or a workspace's submissions started: read, run again, stop. */
export const registerJobsOpenApi = (registry: OpenAPIRegistry): void => {
  const security = [{ bearerAuth: [] }];
  for (const scope of SCOPES) {
    registry.registerPath({
      method: 'get',
      path: scope.path,
      tags: [TAG],
      security,
      request: { params: JobScopeParamsSchema, query: scope.query },
      responses: {
        200: {
          description: `The jobs ${scope.who}'s submissions started, newest first unless sorted otherwise. Error text never holds an address.`,
          content: { 'application/json': { schema: ListJobsResponseSchema } },
        },
        400: { description: 'Invalid filter, page or sort' },
        403: { description: scope.forbidden },
        404: { description: 'Form or workspace not found' },
      },
    });
    registry.registerPath({
      method: 'get',
      path: `${scope.path}/{jobId}`,
      tags: [TAG],
      security,
      request: { params: JobParamsSchema },
      responses: {
        200: jobResponse('One job, its related jobs, and for an email job its counts by address'),
        400: { description: INVALID_ID },
        403: { description: scope.forbidden },
        404: { description: `${NOT_FOUND}, or deleted under retention` },
      },
    });
    registry.registerPath({
      method: 'post',
      path: `${scope.path}/{jobId}/rerun`,
      tags: [TAG],
      security,
      request: { params: JobParamsSchema },
      responses: {
        200: jobResponse(
          'Queued again as the same job, with the options recorded when it was queued',
        ),
        400: { description: INVALID_ID },
        403: { description: scope.forbidden },
        404: { description: NOT_FOUND },
        409: {
          description:
            'Not dead or cancelled; a type this environment does not run; a submission-received job whose actions were queued; or a last run that may still be finishing',
        },
      },
    });
    registry.registerPath({
      method: 'post',
      path: `${scope.path}/{jobId}/cancel`,
      tags: [TAG],
      security,
      request: { params: JobParamsSchema },
      responses: {
        200: jobResponse('Cancelled: the job was queued'),
        202: jobResponse('Stop requested: the job ends at its next heartbeat'),
        400: { description: INVALID_ID },
        403: { description: scope.forbidden },
        404: { description: NOT_FOUND },
        409: { description: 'The job is not queued or running' },
      },
    });
  }
  registry.registerPath({
    method: 'get',
    path: '/workspaces/{id}/jobs/forms',
    tags: [TAG],
    security,
    request: { params: JobScopeParamsSchema },
    responses: {
      200: {
        description: 'The forms that have jobs in the workspace, by name',
        content: { 'application/json': { schema: ListJobFormsResponseSchema } },
      },
      403: { description: 'Requires the workspace owner role' },
      404: { description: 'Workspace not found' },
    },
  });
};
