import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  PostSubmissionActionValuesSchema,
  postSubmissionActionListSchemas,
  postSubmissionSettingsSchemas,
  type PostSubmissionActionValues,
  type SetPostSubmissionFormActionBody,
  type WorkspaceSettings,
} from '@soba/lib';

extendZodWithOpenApi(z);

export const ActionParamsSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .openapi('PostSubmission_ActionParams');

/** The lib values as a named component, so each view and body references it. */
const ActionValuesSchema = PostSubmissionActionValuesSchema.clone().openapi(
  'PostSubmission_ActionValues',
);
const schemas = postSubmissionSettingsSchemas(ActionValuesSchema);
const own = ActionValuesSchema.nullable().openapi({ description: 'Null while the form inherits.' });

export const SetWorkspaceActionBodySchema = schemas.workspace.openapi(
  'PostSubmission_SetWorkspaceActionBody',
);
export const SetFormActionBodySchema = schemas.formBody.openapi('PostSubmission_SetFormActionBody');
export const WorkspaceActionSettingsSchema = schemas.workspace.openapi(
  'PostSubmission_WorkspaceActionSettings',
);
export const FormActionSettingsSchema = schemas.form
  .extend({ own })
  .openapi('PostSubmission_FormActionSettings');

const lists = postSubmissionActionListSchemas(
  FormActionSettingsSchema,
  WorkspaceActionSettingsSchema,
);
export const FormActionListSchema = lists.form.openapi('PostSubmission_FormActionList');
export const WorkspaceActionListSchema = lists.workspace.openapi(
  'PostSubmission_WorkspaceActionList',
);

export type SetWorkspaceActionBody = WorkspaceSettings<PostSubmissionActionValues>;
export type SetFormActionBody = SetPostSubmissionFormActionBody;
