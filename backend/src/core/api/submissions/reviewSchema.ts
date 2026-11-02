import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  AddSubmissionNoteBodySchema as SobaAddSubmissionNoteBodySchema,
  SubmissionEditSchema as SobaSubmissionEditSchema,
  SubmissionNoteSchema as SobaSubmissionNoteSchema,
  SubmissionReviewUserSchema as SobaSubmissionReviewUserSchema,
  SubmissionReviewSubpaths,
  SubmissionStatusChangeSchema as SobaSubmissionStatusChangeSchema,
  UpdateSubmissionStatusBodySchema as SobaUpdateSubmissionStatusBodySchema,
} from '@soba/lib';
import { SubmissionIdParamsSchema } from './schema';

extendZodWithOpenApi(z);

// @soba/lib builds its schemas before zod is extended, so they only get `.openapi()` once cloned.
// The review is rebuilt on its named parts, so the spec references each with $ref.
export const SubmissionReviewUserSchema = SobaSubmissionReviewUserSchema.clone().openapi(
  'Submissions_SubmissionReviewUser',
);
// A union: `.nullable()` on a named schema marks the shared component itself nullable.
export const SubmissionStatusChangeSchema = SobaSubmissionStatusChangeSchema.extend({
  assignee: z.union([SubmissionReviewUserSchema, z.null()]),
}).openapi('Submissions_SubmissionStatusChange');
export const SubmissionNoteSchema = SobaSubmissionNoteSchema.clone().openapi(
  'Submissions_SubmissionNote',
);
export const SubmissionEditSchema = SobaSubmissionEditSchema.clone().openapi(
  'Submissions_SubmissionEdit',
);
export const SubmissionReviewSchema = z
  .object({
    allowStatusUpdates: z.boolean(),
    statusHistory: z.array(SubmissionStatusChangeSchema),
    notes: z.array(SubmissionNoteSchema),
    editHistory: z.array(SubmissionEditSchema),
  })
  .openapi('Submissions_SubmissionReview');
export const AddSubmissionNoteBodySchema = SobaAddSubmissionNoteBodySchema.clone().openapi(
  'Submissions_AddSubmissionNoteBody',
);

export const UpdateSubmissionStatusBodySchema =
  SobaUpdateSubmissionStatusBodySchema.clone().openapi('Submissions_UpdateSubmissionStatusBody');
export const SubmissionReviewersSchema = z
  .object({ items: z.array(SubmissionReviewUserSchema) })
  .openapi('Submissions_SubmissionReviewers');

const TAG = 'core.submissions';
const REVIEW_PATH = '/design/submissions/{id}/review';

const reviewResponses = (description: string) => ({
  200: {
    description,
    content: { 'application/json': { schema: SubmissionReviewSchema } },
  },
  404: { description: 'Submission not found' },
});

export const registerSubmissionReviewOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: REVIEW_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: SubmissionIdParamsSchema },
    responses: reviewResponses(
      'Status history, staff notes and edit history of a submission, each newest first.',
    ),
  });

  registry.registerPath({
    method: 'post',
    path: `${REVIEW_PATH}${SubmissionReviewSubpaths.notes}`,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: SubmissionIdParamsSchema,
      body: { content: { 'application/json': { schema: AddSubmissionNoteBodySchema } } },
    },
    responses: {
      ...reviewResponses(
        'Add a staff note under the id the client chose; a retry of the same note adds it once. Answers with the updated review.',
      ),
      409: { description: 'The note id is already used for a different note (note_id_taken)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${REVIEW_PATH}${SubmissionReviewSubpaths.status}`,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: SubmissionIdParamsSchema,
      body: { content: { 'application/json': { schema: UpdateSubmissionStatusBodySchema } } },
    },
    responses: {
      ...reviewResponses(
        'Move the submission to a new status under the id the client chose, from the status the reviewer saw; a retry of the same change makes it once. Answers with the updated review.',
      ),
      400: {
        description: 'The assignee cannot review submissions of this form (assignee_invalid)',
      },
      403: {
        description:
          "The form's review settings turn status updates off and the submission is not revising (status_updates_disabled)",
      },
      409: {
        description:
          'The status changed since it was read (status_changed), the move is not allowed from the current status (status_move_not_allowed), an anonymous submission cannot be sent back (revision_needs_submitter), or the id is already used (status_id_taken)',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${REVIEW_PATH}${SubmissionReviewSubpaths.reviewers}`,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: SubmissionIdParamsSchema },
    responses: {
      200: {
        description:
          'Who the submission can be assigned to: every active user holding submission_review on its form, by name.',
        content: { 'application/json': { schema: SubmissionReviewersSchema } },
      },
      404: { description: 'Submission not found' },
    },
  });
};
