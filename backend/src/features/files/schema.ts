import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

const NOT_FOUND_DESC = 'Not found';
const INVALID_ID = { description: 'Invalid file id' };
const SUBMISSION_AUTH_REQUIRED =
  'Authentication required (anonymous caller has no access to this submission)';
// Optional auth: anonymous (the public user) or a bearer token. `{}` marks the no-auth case
// explicit rather than leaving security unset.
const PUBLIC_SECURITY = [{}, { bearerAuth: [] }];
const FILES_PATH = '/files';
// Same routes as /files, mounted under submit for the Form.io file component.
const SUBMIT_FILES_PATH = '/submit/files';

export const FileUploadResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    originalName: z.string(),
    size: z.number().nullable(),
    type: z.string().nullable(),
  })
  .openapi('Files_UploadResponse');

const FileGetParamsSchema = z.object({ id: z.string().min(1) }).openapi('Files_GetParams');
const FileDeleteParamsSchema = z.object({ id: z.string().min(1) }).openapi('Files_DeleteParams');
export const SubmissionFileParamsSchema = z
  .object({ id: z.uuid().toLowerCase(), fileId: z.uuid().toLowerCase() })
  .openapi('Files_SubmissionFileParams');

function registerFilesPaths(
  registry: OpenAPIRegistry,
  { basePath, deprecated }: { basePath: string; deprecated: boolean },
) {
  const tag = 'feature.files';

  registry.registerPath({
    method: 'post',
    path: basePath,
    tags: [tag],
    deprecated,
    security: PUBLIC_SECURITY,
    request: {
      body: {
        required: true,
        content: {
          // multipart/form-data: the binary file field (fileKey; default 'file'), plus the required
          // submissionId the upload is authorized and associated against.
          'multipart/form-data': {
            schema: z.object({
              file: z.string().openapi({ format: 'binary' }),
              submissionId: z.string(),
              fileName: z.string().optional(),
              dir: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Uploaded file metadata (Form.io file value)',
        content: { 'application/json': { schema: FileUploadResponseSchema } },
      },
      400: {
        description:
          'Missing submissionId or file, more than one file, too many or too large text fields, or a malformed upload',
      },
      401: { description: SUBMISSION_AUTH_REQUIRED },
      403: {
        description: "Not a participant on this submission, or not in the form's audience",
      },
      404: { description: 'Submission not found' },
      409: { description: 'Submission is not accepting file uploads' },
      413: { description: 'File too large' },
      415: { description: 'File type not allowed (blocked extension)' },
      422: { description: 'File failed virus scan' },
      503: { description: 'Virus scanning unavailable' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${basePath}/{id}`,
    tags: [tag],
    deprecated,
    security: PUBLIC_SECURITY,
    request: { params: FileGetParamsSchema },
    responses: {
      200: {
        description:
          'File contents (stream or redirect). PDF, PNG, JPEG, GIF and WebP show inline. Text, CSV, Office and OpenDocument files download with their type; any other file downloads as application/octet-stream.',
        content: {},
      },
      400: INVALID_ID,
      401: { description: SUBMISSION_AUTH_REQUIRED },
      403: { description: 'Not authorized to access this file' },
      404: { description: NOT_FOUND_DESC },
      503: { description: 'File content unavailable' },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${basePath}/{id}`,
    tags: [tag],
    deprecated,
    security: PUBLIC_SECURITY,
    request: { params: FileDeleteParamsSchema },
    responses: {
      204: { description: 'Deleted' },
      400: INVALID_ID,
      401: { description: SUBMISSION_AUTH_REQUIRED },
      403: { description: 'Not authorized to delete this file' },
      404: { description: NOT_FOUND_DESC },
    },
  });
}

export function registerFilesOpenApi(registry: OpenAPIRegistry) {
  registerFilesPaths(registry, { basePath: FILES_PATH, deprecated: false });
  registerFilesPaths(registry, { basePath: SUBMIT_FILES_PATH, deprecated: true });
  registry.registerPath({
    method: 'get',
    path: '/design/submissions/{id}/files/{fileId}',
    tags: ['feature.files'],
    security: [{ bearerAuth: [] }],
    summary: 'Staff download of a file attached to the submission (needs submission_read)',
    request: { params: SubmissionFileParamsSchema },
    responses: {
      200: { description: 'File contents as an attachment (stream or redirect)', content: {} },
      400: { description: 'Invalid submission or file id' },
      401: { description: 'Authentication required' },
      403: { description: 'Not a member of the workspace, or insufficient form permissions' },
      404: { description: 'Submission, or file attached to it, not found' },
      503: { description: 'File content unavailable' },
    },
  });
}
