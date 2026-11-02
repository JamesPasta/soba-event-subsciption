import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  JobProgressSchema as LibJobProgressSchema,
  JobResultSchema as LibJobResultSchema,
  StartSubmissionExportBodySchema as LibStartSubmissionExportBodySchema,
  SubmissionExportFieldsBodySchema as LibSubmissionExportFieldsBodySchema,
  SubmissionExportFieldsResponseSchema as LibSubmissionExportFieldsResponseSchema,
  SubmissionExportListSchema as LibSubmissionExportListSchema,
  SubmissionExportSchema as LibSubmissionExportSchema,
  SubmissionExportSortSchema as LibSubmissionExportSortSchema,
} from '@soba/lib';
import {
  OFFSET_DRIFT_NOTE,
  OffsetPageSchema,
  offsetQueryFields,
  rejectedCursorField,
} from '../../core/api/shared/offsetPagination';

extendZodWithOpenApi(z);

const EXPORTS_PATH = '/design/forms/{id}/exports';

export const FormIdParamSchema = z.object({ id: z.uuid() }).openapi('SubmissionExport_FormIdParam');

export const ExportIdParamSchema = FormIdParamSchema.extend({ exportId: z.uuid() }).openapi(
  'SubmissionExport_ExportIdParam',
);

export const SubmissionExportFieldsBodySchema = LibSubmissionExportFieldsBodySchema.clone().openapi(
  'SubmissionExport_FieldsBody',
);

export const StartSubmissionExportBodySchema = LibStartSubmissionExportBodySchema.clone().openapi(
  'SubmissionExport_StartBody',
);

const SubmissionExportFieldsResponseSchema =
  LibSubmissionExportFieldsResponseSchema.clone().openapi('SubmissionExport_FieldsResponse');

const JobProgressSchema = LibJobProgressSchema.clone().openapi('SubmissionExport_Progress');
const JobResultSchema = LibJobResultSchema.clone().openapi('SubmissionExport_Result');

const SubmissionExportSchema = LibSubmissionExportSchema.extend({
  progress: JobProgressSchema.optional(),
  result: JobResultSchema.optional(),
}).openapi('SubmissionExport_Export');

const SubmissionExportSortSchema =
  LibSubmissionExportSortSchema.clone().openapi('SubmissionExport_Sort');

export const ListExportsQuerySchema = z
  .object({
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    sort: SubmissionExportSortSchema.default('createdAt:desc'),
  })
  .openapi('SubmissionExport_ListQuery');
export type ListExportsQuery = z.infer<typeof ListExportsQuerySchema>;

const SubmissionExportListSchema = LibSubmissionExportListSchema.extend({
  items: z.array(SubmissionExportSchema),
  page: OffsetPageSchema,
  sort: SubmissionExportSortSchema,
}).openapi('SubmissionExport_ExportList');

const accessResponses = {
  400: { description: 'Invalid form id or request body' },
  401: { description: 'Authentication required' },
  403: { description: 'Not a member of the workspace, or no submission_read on the form' },
  404: { description: 'Form not found, or submission export is turned off' },
} as const;

const exportNotFound = {
  404: { description: "Form not found, or not one of the caller's exports of it" },
} as const;

const jsonBody = (schema: z.ZodType) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const answer = (description: string, schema: z.ZodType) => ({
  description,
  content: { 'application/json': { schema } },
});

export function registerSubmissionExportOpenApi(registry: OpenAPIRegistry) {
  const tag = 'design.submission-export';
  const security = [{ bearerAuth: [] }];

  registry.registerPath({
    method: 'post',
    path: `${EXPORTS_PATH}/fields`,
    tags: [tag],
    security,
    summary: 'The fields an export with these filters can include',
    request: { params: FormIdParamSchema, body: jsonBody(SubmissionExportFieldsBodySchema) },
    responses: {
      200: answer('The field list and submission count.', SubmissionExportFieldsResponseSchema),
      ...accessResponses,
    },
  });

  registry.registerPath({
    method: 'post',
    path: EXPORTS_PATH,
    tags: [tag],
    security,
    summary: "Start an export of the form's submitted submissions, run in the background",
    request: { params: FormIdParamSchema, body: jsonBody(StartSubmissionExportBodySchema) },
    responses: {
      201: answer('The export, queued.', SubmissionExportSchema),
      ...accessResponses,
      429: { description: 'The form already has as many exports queued or running as allowed' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: EXPORTS_PATH,
    tags: [tag],
    security,
    summary: "One page of the caller's exports of the form",
    description: OFFSET_DRIFT_NOTE,
    request: { params: FormIdParamSchema, query: ListExportsQuerySchema },
    responses: {
      200: answer("One page of the caller's exports.", SubmissionExportListSchema),
      ...accessResponses,
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${EXPORTS_PATH}/{exportId}`,
    tags: [tag],
    security,
    summary: "One of the caller's exports, with its status",
    request: { params: ExportIdParamSchema },
    responses: {
      200: answer('The export.', SubmissionExportSchema),
      ...accessResponses,
      ...exportNotFound,
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${EXPORTS_PATH}/{exportId}/file`,
    tags: [tag],
    security,
    summary: "Download a ready export's file",
    request: { params: ExportIdParamSchema },
    responses: {
      200: {
        description: 'The file, as an attachment: CSV as text/csv, JSON as opaque bytes.',
        content: {
          'text/csv': { schema: { type: 'string', format: 'binary' } },
          'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
        },
      },
      ...accessResponses,
      404: {
        description: "Not one of the caller's exports, or its file is not ready or has expired",
      },
      503: { description: 'The download could not be recorded' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${EXPORTS_PATH}/{exportId}/cancel`,
    tags: [tag],
    security,
    summary: 'Stop a queued or running export',
    request: { params: ExportIdParamSchema },
    responses: {
      200: answer('Cancelled.', SubmissionExportSchema),
      202: answer('Asked to stop; it stops at its next check.', SubmissionExportSchema),
      ...accessResponses,
      ...exportNotFound,
      409: { description: 'The export has finished' },
    },
  });
}
