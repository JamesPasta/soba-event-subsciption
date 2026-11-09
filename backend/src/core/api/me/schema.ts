import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  MeActorSchema as LibMeActorSchema,
  MeProfileSchema as LibMeProfileSchema,
  MePreferencesSchema as LibMePreferencesSchema,
  MeCapabilitiesSchema as LibMeCapabilitiesSchema,
  MeResponseSchema as LibMeResponseSchema,
  PatchMeBodySchema as LibPatchMeBodySchema,
  TenantSchema as LibTenantSchema,
  ListTenantsResponseSchema as LibListTenantsResponseSchema,
} from '@soba/lib';

extendZodWithOpenApi(z);

export const MeActorSchema = LibMeActorSchema.clone().openapi('Me_Actor');
export const MeProfileSchema = LibMeProfileSchema.clone().openapi('Me_Profile');
export const MePreferencesSchema = LibMePreferencesSchema.clone().openapi('Me_Preferences');
export const MeCapabilitiesSchema = LibMeCapabilitiesSchema.clone().openapi('Me_Capabilities');

export const MeResponseSchema = LibMeResponseSchema.extend({
  actor: MeActorSchema,
  profile: MeProfileSchema,
  preferences: MePreferencesSchema,
  capabilities: MeCapabilitiesSchema,
}).openapi('Me_Response');

export const PatchMeBodySchema = LibPatchMeBodySchema.extend({
  preferences: MePreferencesSchema,
}).openapi('Me_PatchBody');

export const MeTenantSchema = LibTenantSchema.clone().openapi('Me_Tenant');

export const MeTenantsResponseSchema = LibListTenantsResponseSchema.extend({
  tenants: z.array(MeTenantSchema),
}).openapi('Me_TenantsResponse');

export const registerMeOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: '/me',
    tags: ['core.me'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Current authenticated actor with backend-resolved profile fields',
        content: {
          'application/json': {
            schema: MeResponseSchema,
          },
        },
      },
      404: {
        description: 'Current actor not found',
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/me',
    tags: ['core.me'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: PatchMeBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated current actor preferences',
        content: {
          'application/json': {
            schema: MeResponseSchema,
          },
        },
      },
      400: {
        description: 'Invalid request body',
      },
      403: {
        description: 'Not a member of the requested workspace',
      },
      404: {
        description: 'Current actor not found',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/me/tenants',
    tags: ['core.me'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description:
          "The caller's tenants from the default tenant engine; empty when the engine does not serve the caller's identity provider",
        content: {
          'application/json': {
            schema: MeTenantsResponseSchema,
          },
        },
      },
      400: {
        description: 'Missing actor identity or bearer token',
      },
      503: {
        description: 'The tenant engine is unavailable',
      },
    },
  });
};
