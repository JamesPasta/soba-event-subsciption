import { z } from 'zod';
import {
  inheritableSettingsSchemas,
  type InheritableSettings,
  type SetInheritableSettingsBody,
  type WorkspaceSettings,
} from './inheritable';

/** URL segment of the group, shared by the routes, the SWR keys and the OpenAPI component names. */
export const SUBMITTER_SETTINGS_KEY = 'submitter';

/** What submitters may do. A save sends every setting in the group. */
export const SubmitterSettingsSchema = z.object({
  allowSubmitterDrafts: z.boolean(),
});
export type SubmitterSettings = z.infer<typeof SubmitterSettingsSchema>;

const schemas = inheritableSettingsSchemas(SubmitterSettingsSchema);

/** A workspace's submitter settings, as read and as saved. */
export const WorkspaceSubmitterSettingsSchema = schemas.workspace;
export const FormSubmitterSettingsSchema = schemas.form;
export const SetFormSubmitterSettingsBodySchema = schemas.formBody;

export type WorkspaceSubmitterSettings = WorkspaceSettings<SubmitterSettings>;
export type FormSubmitterSettings = InheritableSettings<SubmitterSettings>;
export type SetFormSubmitterSettingsBody = SetInheritableSettingsBody<SubmitterSettings>;
