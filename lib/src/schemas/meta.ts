import { z } from 'zod';

export const PluginCatalogEntrySchema = z.object({
  code: z.string(),
  enabled: z.boolean(),
  hasApi: z.boolean(),
  apiBasePath: z.string().optional(),
});
export type PluginCatalogEntry = z.infer<typeof PluginCatalogEntrySchema>;

export const PluginsMetaResponseSchema = z.object({
  plugins: z.array(PluginCatalogEntrySchema),
});
export type PluginsMetaResponse = z.infer<typeof PluginsMetaResponseSchema>;

export const FeatureMetaSchema = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.string().nullable(),
  status: z.string(),
  /** How the feature is gated: 'fixed' (everywhere platform-enabled) or 'scoped' (per workspace/form grant). */
  availability: z.string(),
  platformAllowed: z.boolean(),
});
export type FeatureMeta = z.infer<typeof FeatureMetaSchema>;

export const FeaturesMetaResponseSchema = z.object({
  features: z.array(FeatureMetaSchema),
});
export type FeaturesMetaResponse = z.infer<typeof FeaturesMetaResponseSchema>;

export const FeatureAvailabilityResponseSchema = z.object({
  code: z.string(),
  available: z.boolean(),
});
export type FeatureAvailabilityResponse = z.infer<typeof FeatureAvailabilityResponseSchema>;

export const BuildMetaResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  nodeVersion: z.string(),
  gitSha: z.string(),
  gitTag: z.string(),
  imageTag: z.string(),
});
export type BuildMetaResponse = z.infer<typeof BuildMetaResponseSchema>;

export const FrontendConfigMetaResponseSchema = z.object({
  auth: z.object({
    provider: z.literal('keycloak'),
    idpPluginDefaultCode: z.string(),
    keycloak: z.object({
      url: z.string(),
      realm: z.string(),
      clientId: z.string(),
      pkceMethod: z.literal('S256'),
    }),
  }),
  api: z.object({
    baseUrl: z.string(),
  }),
  app: z
    .object({
      designerUrl: z.string().optional(),
      formsUrl: z.string().optional(),
    })
    .optional(),
  build: z.object({
    name: z.string(),
    version: z.string(),
    gitSha: z.string(),
  }),
});
export type FrontendConfigMetaResponse = z.infer<typeof FrontendConfigMetaResponseSchema>;

export const CodeRowWithSourceMetaSchema = z.object({
  code: z.string(),
  display: z.string(),
  sort_order: z.number(),
  is_active: z.boolean(),
  source: z.string(),
});
export type CodeRowWithSourceMeta = z.infer<typeof CodeRowWithSourceMetaSchema>;

export const CodesKeyedMetaResponseSchema = z.record(
  z.string(),
  z.array(CodeRowWithSourceMetaSchema),
);
export type CodesKeyedMetaResponse = z.infer<typeof CodesKeyedMetaResponseSchema>;

export const FormEngineMetaSchema = z.object({
  code: z.string(),
  name: z.string(),
  engineVersion: z.string().nullable(),
  isDefault: z.boolean(),
});
export type FormEngineMeta = z.infer<typeof FormEngineMetaSchema>;

export const FormEnginesMetaResponseSchema = z.object({
  items: z.array(FormEngineMetaSchema),
});
export type FormEnginesMetaResponse = z.infer<typeof FormEnginesMetaResponseSchema>;

/** A provider people can sign in through, and so one a form's audience can name. */
export const LoginProviderMetaSchema = z.object({
  code: z.string(),
  name: z.string(),
});
export type LoginProviderMeta = z.infer<typeof LoginProviderMetaSchema>;

export const LoginProvidersMetaResponseSchema = z.object({
  items: z.array(LoginProviderMetaSchema),
});
export type LoginProvidersMetaResponse = z.infer<typeof LoginProvidersMetaResponseSchema>;

export const RoleWithSourceMetaSchema = z.object({
  roleCode: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RoleWithSourceMeta = z.infer<typeof RoleWithSourceMetaSchema>;

export const RolesMetaResponseSchema = z.object({
  roles: z.array(RoleWithSourceMetaSchema),
});
export type RolesMetaResponse = z.infer<typeof RolesMetaResponseSchema>;

export const FilesConfigMetaResponseSchema = z.object({
  maxFileSizeMb: z.number(),
  blockedExtensions: z.array(z.string()),
});
export type FilesConfigMetaResponse = z.infer<typeof FilesConfigMetaResponseSchema>;
