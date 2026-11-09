import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  PluginCatalogEntrySchema as LibPluginCatalogEntrySchema,
  PluginsMetaResponseSchema as LibPluginsMetaResponseSchema,
  FeatureMetaSchema as LibFeatureMetaSchema,
  FeaturesMetaResponseSchema as LibFeaturesMetaResponseSchema,
  FeatureAvailabilityResponseSchema as LibFeatureAvailabilityResponseSchema,
  BuildMetaResponseSchema as LibBuildMetaResponseSchema,
  FrontendConfigMetaResponseSchema as LibFrontendConfigMetaResponseSchema,
  CodeRowWithSourceMetaSchema as LibCodeRowWithSourceMetaSchema,
  FormEngineMetaSchema as LibFormEngineMetaSchema,
  FormEnginesMetaResponseSchema as LibFormEnginesMetaResponseSchema,
  LoginProviderMetaSchema as LibLoginProviderMetaSchema,
  LoginProvidersMetaResponseSchema as LibLoginProvidersMetaResponseSchema,
  RoleWithSourceMetaSchema as LibRoleWithSourceMetaSchema,
  RolesMetaResponseSchema as LibRolesMetaResponseSchema,
  FilesConfigMetaResponseSchema as LibFilesConfigMetaResponseSchema,
} from '@soba/lib';
import { SortLocaleQuerySchema } from '../shared/offsetPagination';

extendZodWithOpenApi(z);

// @soba/lib builds its schemas before zod is extended, so they only get `.openapi()` once cloned.
// Composites are rebuilt on the named children so the spec references them instead of inlining.
export const PluginCatalogEntrySchema =
  LibPluginCatalogEntrySchema.clone().openapi('Meta_PluginCatalogEntry');

export const PluginsMetaResponseSchema = LibPluginsMetaResponseSchema.extend({
  plugins: z.array(PluginCatalogEntrySchema),
}).openapi('Meta_PluginsResponse');

export const FeatureMetaSchema = LibFeatureMetaSchema.clone().openapi('Meta_Feature');

export const FeaturesMetaResponseSchema = LibFeaturesMetaResponseSchema.extend({
  features: z.array(FeatureMetaSchema),
}).openapi('Meta_FeaturesResponse');

export const FeatureAvailabilityQuerySchema = z
  .object({
    code: z.string().min(1),
    // Validate as uuid so a malformed id is a clean 400, not a uuid-cast 500 in the grant lookup.
    workspaceId: z.string().uuid().optional(),
    formId: z.string().uuid().optional(),
  })
  .openapi('Meta_FeatureAvailabilityQuery');

export const FeatureAvailabilityResponseSchema =
  LibFeatureAvailabilityResponseSchema.clone().openapi('Meta_FeatureAvailabilityResponse');

export const BuildMetaResponseSchema =
  LibBuildMetaResponseSchema.clone().openapi('Meta_BuildResponse');

export const FrontendConfigMetaResponseSchema = LibFrontendConfigMetaResponseSchema.clone().openapi(
  'Meta_FrontendConfigResponse',
);

export const CodeRowWithSourceMetaSchema =
  LibCodeRowWithSourceMetaSchema.clone().openapi('Meta_CodeRowWithSource');

/** Response: object keyed by code set name, values = arrays of code rows with source */
export const CodesKeyedMetaResponseSchema = z
  .record(z.string(), z.array(CodeRowWithSourceMetaSchema))
  .openapi('Meta_CodesKeyedResponse');

export const ListCodesQuerySchema = z
  .object({
    code_set: z.string().optional(),
    source: z.string().optional(),
    is_active: z.enum(['true', 'false']).optional(),
    only_enabled_features: z.enum(['true', 'false']).optional(),
  })
  .openapi('Meta_ListCodesQuery');

export const FormEngineMetaSchema = LibFormEngineMetaSchema.clone().openapi('Meta_FormEngine');

export const FormEnginesMetaResponseSchema = LibFormEnginesMetaResponseSchema.extend({
  items: z.array(FormEngineMetaSchema),
}).openapi('Meta_FormEnginesResponse');

export const LoginProviderMetaSchema =
  LibLoginProviderMetaSchema.clone().openapi('Meta_LoginProvider');

export const LoginProvidersMetaResponseSchema = LibLoginProvidersMetaResponseSchema.extend({
  items: z.array(LoginProviderMetaSchema),
}).openapi('Meta_LoginProvidersResponse');

export const RoleWithSourceMetaSchema =
  LibRoleWithSourceMetaSchema.clone().openapi('Meta_RoleWithSource');

export const ListRolesQuerySchema = z
  .object({
    code: z.string().optional(),
    source: z.string().optional(),
    status: z.string().optional(),
    only_enabled_features: z.enum(['true', 'false']).optional(),
  })
  .openapi('Meta_ListRolesQuery');

export const RolesMetaResponseSchema = LibRolesMetaResponseSchema.extend({
  roles: z.array(RoleWithSourceMetaSchema),
}).openapi('Meta_RolesResponse');

export const FilesConfigMetaResponseSchema = LibFilesConfigMetaResponseSchema.clone().openapi(
  'Meta_FilesConfigResponse',
);

export const registerMetaOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: '/meta/plugins',
    tags: ['core.meta'],
    responses: {
      200: {
        description:
          'Discovered plugin catalog; the active plugin for each type is flagged enabled',
        content: {
          'application/json': {
            schema: PluginsMetaResponseSchema,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/meta/features',
    tags: ['core.meta'],
    responses: {
      200: {
        description: 'DB-backed feature list (code, name, status, availability, platformAllowed)',
        content: {
          'application/json': {
            schema: FeaturesMetaResponseSchema,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/meta/feature-availability',
    tags: ['core.meta'],
    request: { query: FeatureAvailabilityQuerySchema },
    responses: {
      200: {
        description:
          'Whether a feature is available for the given workspace/form scope (fixed → platform-enabled; scoped → an active grant).',
        content: { 'application/json': { schema: FeatureAvailabilityResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/meta/login-providers',
    tags: ['core.meta'],
    request: { query: SortLocaleQuerySchema },
    responses: {
      200: {
        description: 'Active login providers, by name: the providers an audience can name',
        content: { 'application/json': { schema: LoginProvidersMetaResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/meta/form-engines',
    tags: ['core.meta'],
    responses: {
      200: {
        description: 'Installed form engine plugins and which one is the default',
        content: {
          'application/json': {
            schema: FormEnginesMetaResponseSchema,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/meta/build',
    tags: ['core.meta'],
    responses: {
      200: {
        description: 'Build metadata (version and deployment identifiers)',
        content: {
          'application/json': {
            schema: BuildMetaResponseSchema,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/meta/frontend-config',
    tags: ['core.meta'],
    responses: {
      200: {
        description: 'Public runtime configuration needed by the frontend',
        content: {
          'application/json': {
            schema: FrontendConfigMetaResponseSchema,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/meta/codes',
    tags: ['core.meta'],
    request: {
      query: ListCodesQuerySchema,
    },
    responses: {
      200: {
        description:
          'Code sets keyed by name. Query: code_set (single or comma-separated), source, is_active, only_enabled_features.',
        content: {
          'application/json': {
            schema: CodesKeyedMetaResponseSchema,
            example: {
              form_status: [
                {
                  code: 'active',
                  display: 'Active',
                  sort_order: 0,
                  is_active: true,
                  source: 'core',
                },
                {
                  code: 'archived',
                  display: 'Archived',
                  sort_order: 1,
                  is_active: true,
                  source: 'core',
                },
              ],
            },
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/meta/roles',
    tags: ['core.meta'],
    request: {
      query: ListRolesQuerySchema,
    },
    responses: {
      200: {
        description:
          'All roles (flat list). Query: code (comma-separated), source, status, only_enabled_features.',
        content: {
          'application/json': {
            schema: RolesMetaResponseSchema,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/meta/files-config',
    tags: ['core.meta'],
    responses: {
      200: {
        description: 'Files feature config (upload size limit + always-blocked extensions)',
        content: {
          'application/json': {
            schema: FilesConfigMetaResponseSchema,
          },
        },
      },
      404: { description: 'Files feature is disabled' },
    },
  });
};
