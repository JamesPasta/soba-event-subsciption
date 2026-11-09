import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  PrintBodySchema as LibPrintBodySchema,
  PrintOptionsSchema as LibPrintOptionsSchema,
  StaffPrintFactsSchema as LibStaffPrintFactsSchema,
  SubmissionPrintFactsSchema as LibSubmissionPrintFactsSchema,
} from '@soba/lib';

extendZodWithOpenApi(z);

const SUBMISSION_AUTH_REQUIRED =
  'Authentication required (anonymous caller has no access to this submission)';
// Optional auth: anonymous (the public user) or a bearer token. `{}` marks the no-auth case
// explicit rather than leaving security unset.
const PUBLIC_SECURITY = [{}, { bearerAuth: [] }];
const STAFF_SECURITY = [{ bearerAuth: [] }];
const SUBMIT_BASE = '/submit/submissions/{id}';
const DESIGN_BASE = '/design/submissions/{id}';

export const SubmissionIdParamSchema = z
  .object({ id: z.uuid() })
  .openapi('DocumentGeneration_SubmissionIdParam');

export const PrintOptionsSchema = LibPrintOptionsSchema.clone().openapi(
  'DocumentGeneration_PrintOptions',
);

export const PrintBodySchema = LibPrintBodySchema.extend({
  options: PrintOptionsSchema.optional(),
}).openapi('DocumentGeneration_PrintBody');

const SubmissionPrintFactsSchema = LibSubmissionPrintFactsSchema.clone().openapi(
  'DocumentGeneration_SubmissionPrintFacts',
);

const StaffPrintFactsSchema = LibStaffPrintFactsSchema.clone().openapi(
  'DocumentGeneration_StaffPrintFacts',
);

const submitAccessResponses = {
  401: { description: SUBMISSION_AUTH_REQUIRED },
  403: { description: 'Not authorized to generate documents from this submission' },
} as const;

const staffAccessResponses = {
  401: { description: 'Authentication required' },
  403: { description: 'Not a member of the workspace, or insufficient form permissions' },
} as const;

const renderResponses = {
  200: { description: 'Rendered document bytes (attachment)', content: {} },
  400: { description: 'Invalid submission id or request body' },
  404: { description: 'Submission or template not found' },
  422: { description: 'Template could not be rendered, or the submission has no saved data' },
  429: { description: 'Too many render requests' },
  503: {
    description:
      'No document generation backend available, generation busy, or template content unavailable',
  },
} as const;

const printBody = {
  required: true,
  content: { 'application/json': { schema: PrintBodySchema } },
};

export function registerDocumentGenerationOpenApi(registry: OpenAPIRegistry) {
  const tag = 'feature.document-generation';

  registry.registerPath({
    method: 'get',
    path: `${SUBMIT_BASE}/templates`,
    tags: [tag],
    security: PUBLIC_SECURITY,
    summary: "The document template on the submission's form version, and whether it can render",
    request: { params: SubmissionIdParamSchema },
    responses: {
      200: {
        description: 'Templates the caller may render from the submission',
        content: { 'application/json': { schema: SubmissionPrintFactsSchema } },
      },
      400: { description: 'Invalid submission id' },
      ...submitAccessResponses,
      404: { description: 'Submission not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${SUBMIT_BASE}/print`,
    tags: [tag],
    security: PUBLIC_SECURITY,
    summary: "Render a document from a stored template and the submission's persisted data",
    request: { params: SubmissionIdParamSchema, body: printBody },
    responses: { ...renderResponses, ...submitAccessResponses },
  });

  registry.registerPath({
    method: 'get',
    path: `${DESIGN_BASE}/templates`,
    tags: [tag],
    security: STAFF_SECURITY,
    summary: "The document templates on the submission's form version, and whether they can render",
    request: { params: SubmissionIdParamSchema },
    responses: {
      200: {
        description: 'Templates staff may render from the submission',
        content: { 'application/json': { schema: StaffPrintFactsSchema } },
      },
      400: { description: 'Invalid submission id' },
      ...staffAccessResponses,
      404: { description: 'Submission not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${DESIGN_BASE}/print`,
    tags: [tag],
    security: STAFF_SECURITY,
    summary: "Render a document from a stored template and the submission's persisted data",
    request: { params: SubmissionIdParamSchema, body: printBody },
    responses: { ...renderResponses, ...staffAccessResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/design/print-upload/{id}',
    tags: [tag],
    security: STAFF_SECURITY,
    summary: "Render a document from an uploaded template and the submission's persisted data",
    request: {
      params: SubmissionIdParamSchema,
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: LibPrintOptionsSchema.extend({
              file: z.string().openapi({ format: 'binary' }),
            }),
          },
        },
      },
    },
    responses: {
      ...renderResponses,
      ...staffAccessResponses,
      413: { description: 'Template file too large' },
      415: { description: 'Template file type not accepted' },
      422: {
        description:
          'Template could not be rendered, failed the virus scan, or the submission has no saved data',
      },
    },
  });
}
