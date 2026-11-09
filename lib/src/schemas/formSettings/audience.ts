import { z } from 'zod';
import {
  inheritableSettingsSchemas,
  type InheritableSettings,
  type InheritChoice,
  type SetInheritableSettingsBody,
  type WorkspaceSettings,
} from './inheritable';

/** URL segment of the group, shared by the routes, the SWR keys and the OpenAPI component names. */
export const AUDIENCE_SETTINGS_KEY = 'audience';

/**
 * Who outside the workspace may submit: anyone, people signing in through the listed login
 * providers, or no one. People holding a submit role through a group always may.
 */
export const AUDIENCE_MODES = ['public', 'protected', 'members'] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

const NoProviders = z.array(z.string()).max(0);

export const AudienceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('public'), idps: NoProviders }),
  z.object({
    mode: z.literal('protected'),
    idps: z.array(z.string().trim().min(1)).min(1).max(20),
  }),
  z.object({ mode: z.literal('members'), idps: NoProviders }),
]);
export type Audience = z.infer<typeof AudienceSchema>;

const schemas = inheritableSettingsSchemas(AudienceSchema);

/** A workspace's audience, as read and as saved. */
export const WorkspaceAudienceSettingsSchema = schemas.workspace;
export const FormAudienceSettingsSchema = schemas.form;
/** A new form's audience: inherit, or its own. */
export const FormAudienceChoiceSchema = schemas.formChoice;
export const SetFormAudienceSettingsBodySchema = schemas.formBody;

export type WorkspaceAudienceSettings = WorkspaceSettings<Audience>;
export type FormAudienceSettings = InheritableSettings<Audience>;
export type FormAudienceChoice = InheritChoice<Audience>;
export type SetFormAudienceSettingsBody = SetInheritableSettingsBody<Audience>;

/** How many live forms in a workspace use its audience rather than their own. */
export const InheritingFormsSchema = z.object({ count: z.number().int().nonnegative() });
export type InheritingForms = z.infer<typeof InheritingFormsSchema>;
