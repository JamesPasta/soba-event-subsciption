import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  CreateWorkspaceGroupBodySchema as LibCreateGroupBodySchema,
  ListWorkspaceGroupsResponseSchema as LibListGroupsResponseSchema,
  SetWorkspaceGroupRolesBodySchema as LibSetGroupRolesBodySchema,
  UpdateWorkspaceGroupBodySchema as LibUpdateGroupBodySchema,
  WorkspaceGroupMemberSchema as LibGroupMemberSchema,
  WorkspaceGroupSchema as LibGroupSchema,
  WorkspaceGroupSortSchema as LibGroupSortSchema,
} from '@soba/lib';
import { GROUP_NAME_TAKEN, LAST_FORM_ADMIN } from '../../messages';
import {
  offsetQueryFields,
  rejectedCursorField,
  searchQueryField,
  OffsetPageSchema,
  OFFSET_DRIFT_NOTE,
  SortLocaleQuerySchema,
  sortLocaleQueryField,
} from '../shared/offsetPagination';

extendZodWithOpenApi(z);

export const WorkspaceGroupParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('Groups_WorkspaceGroupParams');

export const GroupIdParamsSchema = z
  .object({
    id: z.string().min(1),
    groupId: z.string().min(1),
  })
  .openapi('Groups_GroupIdParams');

export const GroupMemberParamsSchema = z
  .object({
    id: z.string().min(1),
    groupId: z.string().min(1),
    memberId: z.string().min(1),
  })
  .openapi('Groups_GroupMemberParams');

export const CreateGroupBodySchema =
  LibCreateGroupBodySchema.clone().openapi('Groups_CreateGroupBody');

export const UpdateGroupBodySchema =
  LibUpdateGroupBodySchema.clone().openapi('Groups_UpdateGroupBody');

export const SetGroupRolesBodySchema = LibSetGroupRolesBodySchema.clone().openapi(
  'Groups_SetGroupRolesBody',
);

export const AddGroupMemberBodySchema = z
  .object({ kind: z.literal('user'), membershipId: z.string().min(1) })
  .openapi('Groups_AddGroupMemberBody');

export const GroupMemberSchema = LibGroupMemberSchema.clone().openapi('Groups_GroupMember');

export const GroupSchema = LibGroupSchema.extend({
  members: z.array(GroupMemberSchema),
}).openapi('Groups_Group');

export const GroupSortSchema = LibGroupSortSchema.clone().openapi('Groups_GroupSort');

export const ListGroupsQuerySchema = z
  .object({
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    q: searchQueryField.openapi({ description: 'Matches anywhere in the group name.' }),
    sort: GroupSortSchema.default('name:asc'),
    locale: sortLocaleQueryField,
  })
  .openapi('Groups_ListGroupsQuery');

export const ListGroupsResponseSchema = LibListGroupsResponseSchema.extend({
  items: z.array(GroupSchema),
  page: OffsetPageSchema,
  sort: GroupSortSchema,
}).openapi('Groups_ListGroupsResponse');

const TAG = 'core.groups';
const GROUPS_PATH = '/workspaces/{id}/groups';
const GROUP_PATH = '/workspaces/{id}/groups/{groupId}';
const GROUP_ROLES_PATH = '/workspaces/{id}/groups/{groupId}/roles';
const GROUP_MEMBERS_PATH = '/workspaces/{id}/groups/{groupId}/members';
const GROUP_MEMBER_PATH = '/workspaces/{id}/groups/{groupId}/members/{memberId}';

const ERR_MANAGE = 'Workspace management requires an owner or admin role';
const ERR_PEOPLE_READ = 'Actor is not a member of the workspace, or is a viewer';
const ERR_WORKSPACE_NOT_FOUND = 'Workspace not found';
const ERR_WORKSPACE_OR_GROUP_NOT_FOUND = 'Workspace or group not found';
const OK_UPDATED_GROUP = 'Updated group';

const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { 'application/json': { schema } },
});

const jsonResponse = (description: string, schema: z.ZodTypeAny) => ({
  description,
  content: { 'application/json': { schema } },
});

export const registerGroupsOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: GROUPS_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    description: `List the workspace's groups with search and offset pagination. ${OFFSET_DRIFT_NOTE}`,
    request: { query: ListGroupsQuerySchema, params: WorkspaceGroupParamsSchema },
    responses: {
      200: jsonResponse(
        'A page of workspace groups with roles and members',
        ListGroupsResponseSchema,
      ),
      400: { description: 'Invalid query' },
      403: { description: ERR_PEOPLE_READ },
      404: { description: ERR_WORKSPACE_NOT_FOUND },
    },
  });

  registry.registerPath({
    method: 'get',
    path: GROUP_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { query: SortLocaleQuerySchema, params: GroupIdParamsSchema },
    responses: {
      200: jsonResponse('The group with roles and members', GroupSchema),
      403: { description: ERR_PEOPLE_READ },
      404: { description: ERR_WORKSPACE_OR_GROUP_NOT_FOUND },
    },
  });

  registry.registerPath({
    method: 'post',
    path: GROUPS_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: SortLocaleQuerySchema,
      params: WorkspaceGroupParamsSchema,
      body: jsonBody(CreateGroupBodySchema),
    },
    responses: {
      201: jsonResponse('Group created', GroupSchema),
      400: { description: 'Invalid body or unknown role code' },
      403: { description: ERR_MANAGE },
      404: { description: ERR_WORKSPACE_NOT_FOUND },
      409: { description: GROUP_NAME_TAKEN },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: GROUP_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: SortLocaleQuerySchema,
      params: GroupIdParamsSchema,
      body: jsonBody(UpdateGroupBodySchema),
    },
    responses: {
      200: jsonResponse(OK_UPDATED_GROUP, GroupSchema),
      400: { description: 'Invalid body' },
      403: { description: ERR_MANAGE },
      404: { description: ERR_WORKSPACE_OR_GROUP_NOT_FOUND },
      409: { description: GROUP_NAME_TAKEN },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: GROUP_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { query: SortLocaleQuerySchema, params: GroupIdParamsSchema },
    responses: {
      204: { description: 'Group soft-deleted' },
      403: { description: ERR_MANAGE },
      404: { description: ERR_WORKSPACE_OR_GROUP_NOT_FOUND },
    },
  });

  registry.registerPath({
    method: 'put',
    path: GROUP_ROLES_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: SortLocaleQuerySchema,
      params: GroupIdParamsSchema,
      body: jsonBody(SetGroupRolesBodySchema),
    },
    responses: {
      200: jsonResponse(OK_UPDATED_GROUP, GroupSchema),
      400: { description: 'Invalid body or unknown role code' },
      403: { description: ERR_MANAGE },
      404: { description: ERR_WORKSPACE_OR_GROUP_NOT_FOUND },
    },
  });

  registry.registerPath({
    method: 'post',
    path: GROUP_MEMBERS_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: SortLocaleQuerySchema,
      params: GroupIdParamsSchema,
      body: jsonBody(AddGroupMemberBodySchema),
    },
    responses: {
      200: jsonResponse(OK_UPDATED_GROUP, GroupSchema),
      400: { description: 'Membership is not an active member of the workspace' },
      403: { description: ERR_MANAGE },
      404: { description: ERR_WORKSPACE_OR_GROUP_NOT_FOUND },
      409: { description: 'Member already in group' },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: GROUP_MEMBER_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { query: SortLocaleQuerySchema, params: GroupMemberParamsSchema },
    responses: {
      200: jsonResponse(OK_UPDATED_GROUP, GroupSchema),
      403: { description: ERR_MANAGE },
      404: { description: 'Workspace, group, or member not found' },
      409: { description: LAST_FORM_ADMIN },
    },
  });
};
