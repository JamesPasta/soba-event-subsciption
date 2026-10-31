import { extendZodWithOpenApi, type OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  CreateUserFromSearchBodySchema as LibCreateUserBodySchema,
  CreateUserFromSearchResponseSchema as LibCreateUserResponseSchema,
  UserSearchCapabilitiesResponseSchema as LibCapabilitiesResponseSchema,
  UserSearchIdentityProviderSchema as LibIdentityProviderSchema,
  UserSearchPluginStatusSchema as LibPluginStatusSchema,
  UserSearchQuerySchema as LibQuerySchema,
  UserSearchResponseSchema as LibResponseSchema,
  UserSearchUserSchema as LibUserSchema,
} from '@soba/lib';
import { sortLocaleQueryField } from '../../core/api/shared/offsetPagination';

extendZodWithOpenApi(z);

export const UserSearchScopeParamsSchema = z
  .object({ id: z.string().min(1) })
  .openapi('UserSearch_ScopeParams');

export const UserSearchQuerySchema = LibQuerySchema.safeExtend({
  locale: sortLocaleQueryField,
}).openapi('UserSearch_Query');

const UserSchema = LibUserSchema.clone().openapi('UserSearch_User');
const PluginStatusSchema = LibPluginStatusSchema.clone().openapi('UserSearch_PluginStatus');
const IdentityProviderSchema = LibIdentityProviderSchema.clone().openapi(
  'UserSearch_IdentityProvider',
);

export const UserSearchResponseSchema = LibResponseSchema.extend({
  users: z.array(UserSchema),
  plugins: z.array(PluginStatusSchema),
}).openapi('UserSearch_Response');

export const UserSearchCapabilitiesResponseSchema = LibCapabilitiesResponseSchema.extend({
  identityProviders: z.array(IdentityProviderSchema),
}).openapi('UserSearch_CapabilitiesResponse');

export const CreateUserFromSearchBodySchema = LibCreateUserBodySchema.clone().openapi(
  'UserSearch_CreateUserBody',
);

const CreateUserFromSearchResponseSchema = LibCreateUserResponseSchema.clone().openapi(
  'UserSearch_CreateUserResponse',
);

const TAG = 'feature.user-search';

const SCOPES = [
  {
    path: '/workspaces/{id}/user-search',
    subject: 'a workspace',
    forbidden: 'Requires an owner or admin role, or team_update on the workspace',
  },
  {
    path: '/design/forms/{id}/user-search',
    subject: "a form's team",
    forbidden:
      "Requires an owner or admin role in the form's workspace, or team_update on the form",
  },
] as const;

export function registerUserSearchOpenApi(registry: OpenAPIRegistry) {
  for (const scope of SCOPES) {
    registry.registerPath({
      method: 'get',
      path: `${scope.path}/capabilities`,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      summary: `Identity providers and filters for finding people to add to ${scope.subject}`,
      request: { params: UserSearchScopeParamsSchema },
      responses: {
        200: {
          description: 'Searchable identity providers',
          content: { 'application/json': { schema: UserSearchCapabilitiesResponseSchema } },
        },
        403: { description: scope.forbidden },
        404: { description: 'Not found, or user search is disabled' },
      },
    });
    registry.registerPath({
      method: 'get',
      path: scope.path,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      summary: `Find people to add to ${scope.subject}`,
      description:
        'Searches the identityProvider given, or else every identity provider searchable here.',
      request: { params: UserSearchScopeParamsSchema, query: UserSearchQuerySchema },
      responses: {
        200: {
          description: 'People found, merged across the enabled plugins and identity providers',
          content: { 'application/json': { schema: UserSearchResponseSchema } },
        },
        400: {
          description:
            'Invalid filters, an identity provider that cannot be searched, or filters every provider refused',
        },
        403: { description: scope.forbidden },
        404: { description: 'Not found, or user search is disabled' },
        503: { description: 'No user search plugin could answer' },
      },
    });
    registry.registerPath({
      method: 'post',
      path: `${scope.path}/users`,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      summary: `Make a Soba user for a person found when adding to ${scope.subject}`,
      description:
        'Asks the directory again by guid and stores what it returns. A person who already has a Soba user gets it back. The new user has no access, and signs in to the same user later.',
      request: {
        params: UserSearchScopeParamsSchema,
        body: { content: { 'application/json': { schema: CreateUserFromSearchBodySchema } } },
      },
      responses: {
        200: {
          description: 'The person already had a Soba user',
          content: { 'application/json': { schema: CreateUserFromSearchResponseSchema } },
        },
        201: {
          description: 'Soba user created',
          content: { 'application/json': { schema: CreateUserFromSearchResponseSchema } },
        },
        400: { description: 'Invalid body, or an identity provider that cannot be searched here' },
        403: { description: scope.forbidden },
        404: { description: 'Not found, user search is disabled, or no one has that guid' },
        422: { description: "The directory's identifier is not the one sign-in will send" },
        503: { description: 'No user search plugin could answer' },
      },
    });
  }
}
