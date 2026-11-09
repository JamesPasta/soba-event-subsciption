import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  CreateWorkspaceRoleBodySchema as LibCreateRoleBodySchema,
  ListWorkspaceRolesResponseSchema as LibListRolesResponseSchema,
  UpdateWorkspaceRoleBodySchema as LibUpdateRoleBodySchema,
  WorkspaceRoleSchema as LibRoleSchema,
} from '@soba/lib';
import { FIXED_ROLE_READ_ONLY, ROLE_IN_USE, ROLE_NAME_TAKEN } from '../../messages';

extendZodWithOpenApi(z);

export const WorkspaceRoleParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('Roles_WorkspaceRoleParams');

export const RoleCodeParamsSchema = z
  .object({
    id: z.string().min(1),
    roleCode: z.string().min(1),
  })
  .openapi('Roles_RoleCodeParams');

export const CreateRoleBodySchema = LibCreateRoleBodySchema.clone().openapi('Roles_CreateRoleBody');

export const UpdateRoleBodySchema = LibUpdateRoleBodySchema.clone().openapi('Roles_UpdateRoleBody');

export const RoleSchema = LibRoleSchema.clone().openapi('Roles_Role');

export const ListRolesResponseSchema = LibListRolesResponseSchema.extend({
  items: z.array(RoleSchema),
}).openapi('Roles_ListRolesResponse');

const TAG = 'core.roles';
const ROLES_PATH = '/workspaces/{id}/roles';
const ROLE_PATH = '/workspaces/{id}/roles/{roleCode}';

const ERR_MANAGE = 'Workspace management requires an owner or admin role';
const ERR_PEOPLE_READ = 'Actor is not a member of the workspace, or is a viewer';
const ERR_WORKSPACE_NOT_FOUND = 'Workspace not found';
const ERR_WORKSPACE_OR_ROLE_NOT_FOUND = 'Workspace or role not found';

const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { 'application/json': { schema } },
});

const jsonResponse = (description: string, schema: z.ZodTypeAny) => ({
  description,
  content: { 'application/json': { schema } },
});

export const registerRolesOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: ROLES_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    description: "List the roles available in the workspace, with each role's permission codes.",
    request: { params: WorkspaceRoleParamsSchema },
    responses: {
      200: jsonResponse('The roles with their permission codes', ListRolesResponseSchema),
      403: { description: ERR_PEOPLE_READ },
      404: { description: ERR_WORKSPACE_NOT_FOUND },
    },
  });

  registry.registerPath({
    method: 'get',
    path: ROLE_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: RoleCodeParamsSchema },
    responses: {
      200: jsonResponse('The role with its permission codes', RoleSchema),
      403: { description: ERR_PEOPLE_READ },
      404: { description: ERR_WORKSPACE_OR_ROLE_NOT_FOUND },
    },
  });

  registry.registerPath({
    method: 'post',
    path: ROLES_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    description: 'Create a role owned by the workspace. Any permission but `*` can be assigned.',
    request: { params: WorkspaceRoleParamsSchema, body: jsonBody(CreateRoleBodySchema) },
    responses: {
      201: jsonResponse('Role created', RoleSchema),
      400: { description: 'Invalid body or permission code' },
      403: { description: ERR_MANAGE },
      404: { description: ERR_WORKSPACE_NOT_FOUND },
      409: { description: ROLE_NAME_TAKEN },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: ROLE_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    description: 'Change a role the workspace owns. The change applies to its groups at once.',
    request: { params: RoleCodeParamsSchema, body: jsonBody(UpdateRoleBodySchema) },
    responses: {
      200: jsonResponse('Updated role', RoleSchema),
      400: { description: 'Invalid body or permission code' },
      403: { description: ERR_MANAGE },
      404: { description: ERR_WORKSPACE_OR_ROLE_NOT_FOUND },
      409: { description: `${ROLE_NAME_TAKEN}, or ${FIXED_ROLE_READ_ONLY}` },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: ROLE_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    description: 'Soft-delete a role the workspace owns.',
    request: { params: RoleCodeParamsSchema },
    responses: {
      204: { description: 'Role deleted' },
      403: { description: ERR_MANAGE },
      404: { description: ERR_WORKSPACE_OR_ROLE_NOT_FOUND },
      409: { description: `${ROLE_IN_USE}, or ${FIXED_ROLE_READ_ONLY}` },
    },
  });
};
