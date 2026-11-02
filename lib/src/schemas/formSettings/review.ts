import { z } from 'zod';
import {
  inheritableSettingsSchemas,
  type InheritableSettings,
  type SetInheritableSettingsBody,
  type WorkspaceSettings,
} from './inheritable';

/** URL segment of the group, shared by the routes, the SWR keys and the OpenAPI component names. */
export const REVIEW_SETTINGS_KEY = 'review';

/** How a form's submissions are reviewed. A save sends every setting in the group. */
export const ReviewSettingsSchema = z.object({
  /** Reviewers can set a submission's status and assign it. */
  allowStatusUpdates: z.boolean(),
  /** Signed-in owners can take back their own submitted submission to revise it. */
  allowSubmitterRevision: z.boolean(),
});
export type ReviewSettings = z.infer<typeof ReviewSettingsSchema>;

const schemas = inheritableSettingsSchemas(ReviewSettingsSchema);

/** A workspace's review settings, as read and as saved. */
export const WorkspaceReviewSettingsSchema = schemas.workspace;
export const FormReviewSettingsSchema = schemas.form;
export const SetFormReviewSettingsBodySchema = schemas.formBody;

export type WorkspaceReviewSettings = WorkspaceSettings<ReviewSettings>;
export type FormReviewSettings = InheritableSettings<ReviewSettings>;
export type SetFormReviewSettingsBody = SetInheritableSettingsBody<ReviewSettings>;
