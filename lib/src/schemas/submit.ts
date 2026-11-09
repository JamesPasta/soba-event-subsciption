import { z } from 'zod';
import { SubmitterFormSchema } from './forms';
import { MySubmissionRoleSchema } from './submissions';

export const SubmissionDataDocumentSchema = z
  .object({
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());
export type SubmissionDataDocument = z.infer<typeof SubmissionDataDocumentSchema>;

export const SubmitFillBundleSchema = z.object({
  formId: z.string(),
  workflowState: z.string(),
  formVersionId: z.string(),
  headRevisionId: z.string().nullable(),
  // The head revision's number, in append order over every revision.
  currentRevisionNo: z.number().int(),
  // The caller's active grant on the submission.
  role: MySubmissionRoleSchema,
  // The form and its facts for the caller, as My Forms lists it.
  form: SubmitterFormSchema,
  schema: z.record(z.string(), z.unknown()),
  content: SubmissionDataDocumentSchema.nullable(),
});
export type SubmitFillBundle = z.infer<typeof SubmitFillBundleSchema>;

/** A form version's schema for starting a submission: the published version, as stored. */
export const SubmitFormVersionSchemaResponseSchema = z.object({
  formId: z.string(),
  formVersionId: z.string(),
  versionNo: z.number().int(),
  schema: z.record(z.string(), z.unknown()),
  // Covers what the engine renders, not the stored identity: versions differing only there match.
  schemaHash: z.string(),
});
export type SubmitFormVersionSchemaResponse = z.infer<typeof SubmitFormVersionSchemaResponseSchema>;
