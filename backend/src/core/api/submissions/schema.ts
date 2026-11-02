import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  SubmissionListItemSchema as SobaSubmissionListItemSchema,
  SubmissionDataBodySchema as SobaSubmissionDataBodySchema,
  SubmitSubmissionBodySchema as SobaSubmitSubmissionBodySchema,
  OpenSubmissionBodySchema as SobaOpenSubmissionBodySchema,
  SubmissionResponseSchema as SobaSubmissionResponseSchema,
  SubmissionRevisionInfoSchema as SobaSubmissionRevisionInfoSchema,
  ListSubmissionsResponseSchema as SobaListSubmissionsResponseSchema,
  SubmissionSortSchema as SobaSubmissionSortSchema,
  StaffSubmissionSortSchema as SobaStaffSubmissionSortSchema,
  SubmissionReviewStatusSchema,
} from '@soba/lib';

import {
  offsetQueryFields,
  rejectedCursorField,
  searchQueryField,
  OffsetPageSchema,
  OFFSET_DRIFT_NOTE,
  sortLocaleQueryField,
} from '../shared/offsetPagination';
import {
  workspaceIdQueryField,
  formIdQueryField,
  formVersionIdQueryField,
  submissionIdQueryField,
  requireAtLeastOneQueryField,
} from '../shared/schema';

extendZodWithOpenApi(z);

// @soba/lib builds its schemas before zod is extended, so they only get `.openapi()` once cloned.
// Composites are rebuilt on the named children so the spec references them instead of inlining.

// The client mints the submission id (uuidv7) so it can originate a submission without a round-trip.
// Create is idempotent on this id (see openSubmission), which is what makes a retry safe. Enforce v7
// specifically: the id is the record's identity, so we reject nil/low-entropy or wrong-version uuids.
export const OpenSubmissionBodySchema = SobaOpenSubmissionBodySchema.clone().openapi(
  'Submissions_OpenSubmissionBody',
);

// The submission id path param, shared by every /:id route (read/save/submit/delete).
export const SubmissionIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('Submissions_SubmissionIdParams');

// The save body.
export const SubmissionDataBodySchema = SobaSubmissionDataBodySchema.clone().openapi(
  'Submissions_SubmissionDataBody',
);

// The submit body.
export const SubmitSubmissionBodySchema = SobaSubmitSubmissionBodySchema.clone().openapi(
  'Submissions_SubmitSubmissionBody',
);

export const SubmissionSortSchema = SobaSubmissionSortSchema.clone().openapi(
  'Submissions_SubmissionSort',
  { description: 'Valid submission sort tokens: `field:asc` or `field:desc`.' },
);

export const StaffSubmissionSortSchema = SobaStaffSubmissionSortSchema.clone().openapi(
  'Submissions_StaffSubmissionSort',
  {
    description:
      'Valid staff submission sort tokens: `field:asc` or `field:desc`; also by review status and assignee.',
  },
);

export const ListSubmissionsQuerySchema = requireAtLeastOneQueryField(
  z.object({
    workspaceId: workspaceIdQueryField.optional(),
    formId: formIdQueryField,
    formVersionId: formVersionIdQueryField,
    submissionId: submissionIdQueryField,
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    // Workflow state orders by code, not by where the workflow has reached, so it is a filter only.
    workflowState: z.string().trim().min(1).optional(),
    reviewStatus: SubmissionReviewStatusSchema.optional().openapi({
      description: 'Only submissions whose review is at this status.',
    }),
    assigneeId: z.uuid().optional().openapi({
      description: 'Only submissions assigned to this user.',
    }),
    createdBy: z.string().trim().min(1).optional(),
    q: searchQueryField.openapi({
      description:
        'Matches anywhere in the form name, the submission id, or a submitted confirmation code.',
    }),
    sort: StaffSubmissionSortSchema.default('updatedAt:desc'),
    locale: sortLocaleQueryField,
  }),
  ['workspaceId', 'formId', 'formVersionId', 'submissionId'],
  'At least one of workspaceId, formId, formVersionId, or submissionId is required',
).openapi('Submissions_ListSubmissionsQuery');

export const SubmissionListItemSchema = SobaSubmissionListItemSchema.clone().openapi(
  'Submissions_SubmissionListItem',
);

export const SubmissionResponseSchema = SobaSubmissionResponseSchema.clone().openapi(
  'Submissions_SubmissionResponse',
);

export const SubmissionRevisionInfoSchema = SobaSubmissionRevisionInfoSchema.clone().openapi(
  'Submissions_SubmissionRevisionInfo',
);

// Save/submit response: the submission plus the revision this write produced (current or pending).
export const SubmissionWriteResponseSchema = SobaSubmissionResponseSchema.extend({
  revision: SubmissionRevisionInfoSchema,
}).openapi('Submissions_SubmissionWriteResponse');

export const ListSubmissionsResponseSchema = SobaListSubmissionsResponseSchema.extend({
  items: z.array(SubmissionListItemSchema),
  page: OffsetPageSchema,
  sort: StaffSubmissionSortSchema,
}).openapi('Submissions_ListSubmissionsResponse');

const TAG = 'core.submissions';
const SUBMISSION_PATH = '/design/submissions/{id}';
const SUBMISSION_NOT_FOUND = 'Submission not found';

export const registerSubmissionsOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: '/design/submissions',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: ListSubmissionsQuerySchema,
    },
    responses: {
      200: {
        description: `List submissions with search and offset pagination. ${OFFSET_DRIFT_NOTE}`,
        content: {
          'application/json': {
            schema: ListSubmissionsResponseSchema,
          },
        },
      },
      400: {
        description: 'Missing scope anchor, inconsistent hierarchy ids, or invalid query',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: SUBMISSION_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: SubmissionIdParamsSchema,
    },
    responses: {
      200: {
        description: 'Get submission by id',
        content: { 'application/json': { schema: SubmissionResponseSchema } },
      },
      404: {
        description: SUBMISSION_NOT_FOUND,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/design/submissions/{id}/data',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: SubmissionIdParamsSchema,
    },
    responses: {
      200: {
        description: 'Submission answer document (engine document, engine-managed fields stripped)',
        content: {
          'application/json': { schema: z.record(z.string(), z.unknown()) },
        },
      },
      404: {
        description: 'Submission or its engine content not found',
      },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/design/submissions/{id}/data',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: SubmissionIdParamsSchema,
      body: {
        required: true,
        content: { 'application/json': { schema: SubmissionDataBodySchema } },
      },
    },
    responses: {
      200: {
        description:
          'The submission after staff changed its answers, which the form engine validated; a retry of the same revision id answers the same',
        content: { 'application/json': { schema: SubmissionResponseSchema } },
      },
      400: { description: 'Invalid body, or answers the form engine rejects' },
      403: { description: 'Not authorized: needs submission_update on the form' },
      404: { description: SUBMISSION_NOT_FOUND },
      409: {
        description:
          'Not submitted (edit_closed), the answers changed since they were loaded (data_changed), or the revision id is used by another write (revision_id_taken)',
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: SUBMISSION_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: SubmissionIdParamsSchema,
    },
    responses: {
      204: {
        description: 'Submission marked as deleted',
      },
      404: {
        description: SUBMISSION_NOT_FOUND,
      },
    },
  });
};
