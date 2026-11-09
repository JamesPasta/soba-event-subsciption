import { z } from 'zod';

export const MeActorSchema = z.object({
  id: z.string(),
  displayLabel: z.string().nullable(),
  status: z.string(),
});
export type MeActor = z.infer<typeof MeActorSchema>;

export const MeProfileSchema = z.object({
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  preferredUsername: z.string().nullable(),
  // The provider this session signed in through, which a protected audience is checked against.
  idpCode: z.string().nullable(),
});
export type MeProfile = z.infer<typeof MeProfileSchema>;

export const MePreferencesSchema = z.object({
  defaultWorkspaceId: z.string().uuid().nullable().optional(),
});
export type MePreferences = z.infer<typeof MePreferencesSchema>;

/**
 * `disclaimer_required`: the user may create forms in some workspace, but none of those workspaces
 * has accepted the disclaimer.
 */
export const FormCreateCapabilitySchema = z.enum(['allowed', 'disclaimer_required', 'none']);
export type FormCreateCapability = z.infer<typeof FormCreateCapabilitySchema>;

export const MeCapabilitiesSchema = z.object({
  canCreateWorkspace: z.boolean(),
  /** Active member of at least one workspace. */
  hasWorkspaces: z.boolean(),
  formCreate: FormCreateCapabilitySchema,
  /** Platform admin via the soba_admin table: IdP-sourced or granted directly. */
  isSobaAdmin: z.boolean(),
});
export type MeCapabilities = z.infer<typeof MeCapabilitiesSchema>;

export const MeResponseSchema = z.object({
  actor: MeActorSchema,
  profile: MeProfileSchema,
  preferences: MePreferencesSchema,
  capabilities: MeCapabilitiesSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const PatchMeBodySchema = z.object({
  preferences: MePreferencesSchema,
});
export type PatchMeBody = z.infer<typeof PatchMeBodySchema>;
