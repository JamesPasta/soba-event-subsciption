import { z } from 'zod';
import { EmailAddressSchema } from './email';
import {
  inheritableSettingsSchemas,
  type InheritableSettings,
  type SetInheritableSettingsBody,
} from './formSettings/inheritable';

/** URL segment of the group; one action's settings are at `post-submission/<code>`. */
export const POST_SUBMISSION_SETTINGS_KEY = 'post-submission';

/** Where an action is set: a workspace default its forms inherit, or one form. */
export const PostSubmissionActionScopeSchema = z.enum(['workspace', 'form']);
export type PostSubmissionActionScope = z.infer<typeof PostSubmissionActionScopeSchema>;

/** One action's settings at one scope. Options are checked against the action's own schema. */
export const PostSubmissionActionValuesSchema = z.strictObject({
  enabled: z.boolean(),
  options: z.record(z.string(), z.unknown()),
});
export type PostSubmissionActionValues = z.infer<typeof PostSubmissionActionValuesSchema>;

/** 0 for a scope with no saved row yet; the first save names it. */
const PostSubmissionVersionSchema = z.number().int().nonnegative();

/**
 * The schemas of one action's settings, built on `values` so the backend can pass its named
 * component. A scope has no row until its first save, so its version may be 0.
 */
export const postSubmissionSettingsSchemas = <T extends z.ZodType>(values: T) =>
  inheritableSettingsSchemas(values, PostSubmissionVersionSchema);

const actionList = <E extends z.ZodRawShape>(extra: E) =>
  z.object({
    actions: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        scopes: z.array(PostSubmissionActionScopeSchema),
        ...extra,
      }),
    ),
  });

/**
 * The lists of actions configurable at each scope, built on the settings schemas. A form's says
 * whether its workspace can set each action; when it cannot, the form sets it alone.
 */
export const postSubmissionActionListSchemas = <F extends z.ZodType, W extends z.ZodType>(
  form: F,
  workspace: W,
) => ({
  form: actionList({ workspaceConfigurable: z.boolean(), settings: form }),
  workspace: actionList({ settings: workspace }),
});

const schemas = postSubmissionSettingsSchemas(PostSubmissionActionValuesSchema);
const lists = postSubmissionActionListSchemas(schemas.form, schemas.workspace);

export const PostSubmissionFormActionListSchema = lists.form;
export const PostSubmissionWorkspaceActionListSchema = lists.workspace;

export type PostSubmissionFormActionSettings = InheritableSettings<PostSubmissionActionValues>;
export type SetPostSubmissionFormActionBody =
  SetInheritableSettingsBody<PostSubmissionActionValues>;
export type PostSubmissionFormActionList = z.infer<typeof PostSubmissionFormActionListSchema>;
export type PostSubmissionWorkspaceActionList = z.infer<
  typeof PostSubmissionWorkspaceActionListSchema
>;

/** The most addresses one email action sends to. */
export const POST_SUBMISSION_EMAIL_MAX_ADDRESSES = 100;

/** One recipient as the email action keeps it: trimmed, lower-cased, then checked. */
export const PostSubmissionEmailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(EmailAddressSchema);

/** The email action's options: 1 to 100 addresses, de-duplicated. */
export const PostSubmissionEmailAddressesOptionsSchema = z.strictObject({
  to: z
    .array(PostSubmissionEmailAddressSchema)
    .min(1)
    .max(POST_SUBMISSION_EMAIL_MAX_ADDRESSES)
    .transform((addresses) => [...new Set(addresses)]),
});
export type PostSubmissionEmailAddressesOptions = z.infer<
  typeof PostSubmissionEmailAddressesOptionsSchema
>;

/** The longest note the log action keeps. */
export const POST_SUBMISSION_LOG_NOTE_MAX = 200;

/** The log action's options: an optional note. */
export const PostSubmissionLogOptionsSchema = z.strictObject({
  note: z.string().max(POST_SUBMISSION_LOG_NOTE_MAX).optional(),
});
export type PostSubmissionLogOptions = z.infer<typeof PostSubmissionLogOptionsSchema>;
