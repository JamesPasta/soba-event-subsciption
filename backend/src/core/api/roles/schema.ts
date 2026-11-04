import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  ListWorkspaceRolesResponseSchema as LibListRolesResponseSchema,
  WorkspaceRoleSchema as LibRoleSchema,
} from '@soba/lib';

extendZodWithOpenApi(z);

export const WorkspaceRoleParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('Roles_WorkspaceRoleParams');

export const RoleSchema = LibRoleSchema.clone().openapi('Roles_Role');

export const ListRolesResponseSchema = LibListRolesResponseSchema.extend({
  items: z.array(RoleSchema),
}).openapi('Roles_ListRolesResponse');

export const registerRolesOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: '/workspaces/{id}/roles',
    tags: ['core.roles'],
    security: [{ bearerAuth: [] }],
    description: "List the roles available in the workspace, with each role's permission codes.",
    request: { params: WorkspaceRoleParamsSchema },
    responses: {
      200: {
        description: 'The roles with their permission codes',
        content: { 'application/json': { schema: ListRolesResponseSchema } },
      },
      403: { description: 'Actor is not a member of the workspace, or is a viewer' },
      404: { description: 'Workspace not found' },
    },
  });
};
