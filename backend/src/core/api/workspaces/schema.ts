import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  WorkspaceItemSchema as SobaWorkspaceItemSchema,
  CreateWorkspaceBodySchema as SobaCreateWorkspaceBodySchema,
  UpdateWorkspaceBodySchema as SobaUpdateWorkspaceBodySchema,
  WorkspaceSortSchema as SobaWorkspaceSortSchema,
  ListWorkspacesResponseSchema as SobaListWorkspacesResponseSchema,
  WorkspaceLookupItemSchema as SobaWorkspaceLookupItemSchema,
  WorkspaceLookupResponseSchema as SobaWorkspaceLookupResponseSchema,
  WorkspaceNameAvailabilityResponseSchema as SobaWorkspaceNameAvailabilityResponseSchema,
} from '@soba/lib';

import {
  offsetQueryFields,
  rejectedCursorField,
  searchQueryField,
  OffsetPageSchema,
  OFFSET_DRIFT_NOTE,
  sortLocaleQueryField,
} from '../shared/offsetPagination';
import { LOOKUP_NOTE } from '../shared/lookup';
import { WORKSPACE_NAME_TAKEN } from '../../messages';

extendZodWithOpenApi(z);

// @soba/lib builds its schemas before zod is extended, so they only get `.openapi()` once cloned.
// Composites are rebuilt on the named children so the spec references them instead of inlining.
export const WorkspaceItemSchema = SobaWorkspaceItemSchema.clone().openapi(
  'Workspaces_WorkspaceItem',
);

export const WorkspaceSortSchema = SobaWorkspaceSortSchema.clone().openapi(
  'Workspaces_WorkspaceSort',
  { description: 'Valid workspace sort tokens: `field:asc` or `field:desc`.' },
);

export const ListWorkspacesQuerySchema = z
  .object({
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    kind: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
    q: searchQueryField.openapi({
      description: 'Matches anywhere in the workspace name or organization.',
    }),
    requiredPermission: z.string().trim().min(1).optional(),
    sort: WorkspaceSortSchema.default('name:asc'),
    locale: sortLocaleQueryField,
  })
  .openapi('Workspaces_ListWorkspacesQuery');

export const ListWorkspacesResponseSchema = SobaListWorkspacesResponseSchema.extend({
  items: z.array(WorkspaceItemSchema),
  page: OffsetPageSchema,
  sort: WorkspaceSortSchema,
}).openapi('Workspaces_ListWorkspacesResponse');

const MAX_REQUIRED_PERMISSIONS = 10;

export const WorkspaceLookupQuerySchema = z
  .object({
    q: searchQueryField.openapi({
      description: 'Matches anywhere in the workspace name or organization.',
    }),
    locale: sortLocaleQueryField,
    requiredPermissions: z
      .string()
      .trim()
      .regex(/^[a-z_]+(?:,[a-z_]+)*$/)
      .refine((codes) => codes.split(',').length <= MAX_REQUIRED_PERMISSIONS, {
        message: `at most ${MAX_REQUIRED_PERMISSIONS} permission codes`,
      })
      .optional()
      .openapi({
        description: `Comma-separated permission codes, at most ${MAX_REQUIRED_PERMISSIONS}. The caller must hold every one.`,
        example: 'form_create,design_create',
      }),
    disclaimerAccepted: z.enum(['true', 'false']).optional(),
  })
  .openapi('Workspaces_WorkspaceLookupQuery');

export const WorkspaceLookupItemSchema = SobaWorkspaceLookupItemSchema.clone().openapi(
  'Workspaces_WorkspaceLookupItem',
);

export const WorkspaceLookupResponseSchema = SobaWorkspaceLookupResponseSchema.extend({
  items: z.array(WorkspaceLookupItemSchema),
}).openapi('Workspaces_WorkspaceLookupResponse');

export const CurrentWorkspaceResponseSchema = WorkspaceItemSchema.openapi(
  'Workspaces_CurrentWorkspaceResponse',
);

export const WorkspaceIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('Workspaces_WorkspaceIdParams');

export const CreateWorkspaceBodySchema = SobaCreateWorkspaceBodySchema.clone().openapi(
  'Workspaces_CreateWorkspaceBody',
);

export const UpdateWorkspaceBodySchema = SobaUpdateWorkspaceBodySchema.clone().openapi(
  'Workspaces_UpdateWorkspaceBody',
);

export const WorkspaceNameAvailabilityQuerySchema = z
  .object({
    org: z.string().trim().min(1),
    name: z.string().trim().min(1),
    // The workspace being edited, so its own (unchanged) name doesn't report itself as taken.
    excludeId: z.string().uuid().optional(),
  })
  .openapi('Workspaces_WorkspaceNameAvailabilityQuery');

export const WorkspaceNameAvailabilityResponseSchema =
  SobaWorkspaceNameAvailabilityResponseSchema.clone().openapi(
    'Workspaces_WorkspaceNameAvailabilityResponse',
  );

const TAG = 'core.workspaces';
const WORKSPACES_PATH = '/workspaces';
const WORKSPACE_PATH = `${WORKSPACES_PATH}/{id}`;
const INVALID_QUERY = 'Invalid query';

export const registerWorkspacesOpenApi = (registry: OpenAPIRegistry) => {
  registry.registerPath({
    method: 'get',
    path: WORKSPACES_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: ListWorkspacesQuerySchema,
    },
    responses: {
      200: {
        description: `List workspaces for the current user with search and offset pagination. ${OFFSET_DRIFT_NOTE}`,
        content: {
          'application/json': {
            schema: ListWorkspacesResponseSchema,
          },
        },
      },
      400: { description: INVALID_QUERY },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${WORKSPACES_PATH}/lookup`,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: WorkspaceLookupQuerySchema,
    },
    responses: {
      200: {
        description: `Workspaces the current user belongs to, for a select. ${LOOKUP_NOTE}`,
        content: {
          'application/json': {
            schema: WorkspaceLookupResponseSchema,
          },
        },
      },
      400: { description: INVALID_QUERY },
    },
  });

  registry.registerPath({
    method: 'get',
    path: WORKSPACE_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: WorkspaceIdParamsSchema,
    },
    responses: {
      200: {
        description: 'Select a workspace by id (verifies membership)',
        content: {
          'application/json': {
            schema: CurrentWorkspaceResponseSchema,
          },
        },
      },
      403: { description: 'Actor is not a member of the workspace' },
      404: { description: 'Workspace not found' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${WORKSPACES_PATH}/name-availability`,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: WorkspaceNameAvailabilityQuerySchema,
    },
    responses: {
      200: {
        description:
          'Whether a team workspace name is free in this org, case-insensitively (for a live check as the name is typed).',
        content: {
          'application/json': {
            schema: WorkspaceNameAvailabilityResponseSchema,
          },
        },
      },
      400: { description: INVALID_QUERY },
    },
  });

  registry.registerPath({
    method: 'post',
    path: WORKSPACES_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateWorkspaceBodySchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Workspace created',
        content: {
          'application/json': {
            schema: WorkspaceItemSchema,
          },
        },
      },
      400: { description: 'Invalid body' },
      409: { description: WORKSPACE_NAME_TAKEN },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: WORKSPACE_PATH,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: WorkspaceIdParamsSchema,
      body: {
        content: {
          'application/json': {
            schema: UpdateWorkspaceBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Workspace updated',
        content: {
          'application/json': {
            schema: WorkspaceItemSchema,
          },
        },
      },
      403: { description: 'Only workspace owners can rename this workspace' },
      404: { description: 'Workspace not found' },
      409: { description: WORKSPACE_NAME_TAKEN },
    },
  });
};
