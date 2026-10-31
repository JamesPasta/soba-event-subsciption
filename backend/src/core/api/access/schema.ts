import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  AddWorkspaceAccessBodySchema as LibAddBodySchema,
  ListWorkspaceAccessResponseSchema as LibListResponseSchema,
  SetWorkspaceAccessGroupsBodySchema as LibSetGroupsBodySchema,
  WorkspaceAccessIncludeSchema as LibIncludeSchema,
  WorkspaceAccessMemberSchema as LibMemberSchema,
  WorkspaceAccessSortSchema as LibSortSchema,
} from '@soba/lib';
import { LAST_FORM_ADMIN, MEMBER_EXISTS, MEMBER_PROTECTED } from '../../messages';
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

export const AccessWorkspaceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('Access_WorkspaceParams');

export const AccessMemberParamsSchema = z
  .object({
    id: z.string().min(1),
    membershipId: z.string().min(1),
  })
  .openapi('Access_MemberParams');

export const AddAccessBodySchema = LibAddBodySchema.clone().openapi('Access_AddBody');

export const SetAccessGroupsBodySchema =
  LibSetGroupsBodySchema.clone().openapi('Access_SetGroupsBody');

export const AccessMemberSchema = LibMemberSchema.clone().openapi('Access_Member');

export const AccessSortSchema = LibSortSchema.clone().openapi('Access_Sort');

export const AccessIncludeSchema = LibIncludeSchema.clone().openapi('Access_Include', {
  description: 'grouped: members in at least one group. all: every active member.',
});

export const ListAccessQuerySchema = z
  .object({
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    q: searchQueryField.openapi({
      description: 'Matches anywhere in the member display label or email.',
    }),
    include: AccessIncludeSchema.default('grouped'),
    sort: AccessSortSchema.default('displayLabel:asc'),
    locale: sortLocaleQueryField,
  })
  .openapi('Access_ListQuery');

export const ListAccessResponseSchema = LibListResponseSchema.extend({
  items: z.array(AccessMemberSchema),
  page: OffsetPageSchema,
  sort: AccessSortSchema,
}).openapi('Access_ListResponse');

const TAG = 'core.access';
const MEMBERS_PATH = '/workspaces/{id}/members';
const MEMBER_PATH = '/workspaces/{id}/members/{membershipId}';
const MEMBER_GROUPS_PATH = '/workspaces/{id}/members/{membershipId}/groups';

const ERR_MANAGE = 'Workspace management requires an owner or admin role';
const ERR_MEMBER_NOT_FOUND = 'Workspace or active member not found';
const ERR_INVALID_GROUPS = 'Invalid body, or a group that is not active in the workspace';

const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { 'application/json': { schema } },
});

const jsonResponse = (description: string, schema: z.ZodTypeAny) => ({
  description,
  content: { 'application/json': { schema } },
});

export const registerAccessOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: MEMBERS_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    description: `List the workspace's active members with their groups. ${OFFSET_DRIFT_NOTE}`,
    request: { query: ListAccessQuerySchema, params: AccessWorkspaceParamsSchema },
    responses: {
      200: jsonResponse('A page of members with their groups', ListAccessResponseSchema),
      400: { description: 'Invalid query' },
      403: { description: ERR_MANAGE },
      404: { description: 'Workspace not found' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: MEMBER_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { query: SortLocaleQuerySchema, params: AccessMemberParamsSchema },
    responses: {
      200: jsonResponse('The member with their groups', AccessMemberSchema),
      403: { description: ERR_MANAGE },
      404: { description: ERR_MEMBER_NOT_FOUND },
    },
  });

  registry.registerPath({
    method: 'post',
    path: MEMBERS_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    description:
      'Give a user access to the workspace as a viewer, in the groups given. Reactivates a removed membership.',
    request: {
      query: SortLocaleQuerySchema,
      params: AccessWorkspaceParamsSchema,
      body: jsonBody(AddAccessBodySchema),
    },
    responses: {
      201: jsonResponse('Member added', AccessMemberSchema),
      400: { description: `${ERR_INVALID_GROUPS}, or a user that cannot be added` },
      403: { description: ERR_MANAGE },
      404: { description: 'Workspace not found' },
      409: { description: MEMBER_EXISTS },
    },
  });

  registry.registerPath({
    method: 'put',
    path: MEMBER_GROUPS_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    description: "Replace the member's groups in the workspace.",
    request: {
      query: SortLocaleQuerySchema,
      params: AccessMemberParamsSchema,
      body: jsonBody(SetAccessGroupsBodySchema),
    },
    responses: {
      200: jsonResponse('Updated member', AccessMemberSchema),
      400: { description: ERR_INVALID_GROUPS },
      403: { description: ERR_MANAGE },
      404: { description: ERR_MEMBER_NOT_FOUND },
      409: { description: LAST_FORM_ADMIN },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: MEMBER_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    description: 'Remove the member from every group and make the membership inactive.',
    request: { query: SortLocaleQuerySchema, params: AccessMemberParamsSchema },
    responses: {
      204: { description: 'Member removed' },
      403: { description: ERR_MANAGE },
      404: { description: ERR_MEMBER_NOT_FOUND },
      409: { description: `${MEMBER_PROTECTED}. ${LAST_FORM_ADMIN}.` },
    },
  });
};
