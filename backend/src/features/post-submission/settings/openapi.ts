import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { ZodTypeAny } from 'zod';
import type { RegisterOpenApiPaths } from '../../../core/api/shared/openapi';
import {
  FormSettingsParamsSchema,
  WorkspaceSettingsParamsSchema,
} from '../../form-settings/schema';
import {
  ActionParamsSchema,
  FormActionListSchema,
  FormActionSettingsSchema,
  SetFormActionBodySchema,
  SetWorkspaceActionBodySchema,
  WorkspaceActionListSchema,
  WorkspaceActionSettingsSchema,
} from './schema';

const TAG = 'core.form-settings';
const NOT_FOUND = 'Not found, the feature is not available, or the action is not configurable here';
const LIST_NOT_FOUND = 'Not found, or the feature is not available';
const BAD_CODE = 'The action code is not lowercase words joined by dashes';

interface ScopeDocs {
  path: string;
  listParams: typeof FormSettingsParamsSchema;
  list: ZodTypeAny;
  settings: ZodTypeAny;
  body: ZodTypeAny;
  forbidden: string;
}

const registerScope = (registry: OpenAPIRegistry, docs: ScopeDocs): void => {
  const security = [{ bearerAuth: [] }];
  registry.registerPath({
    method: 'get',
    path: docs.path,
    tags: [TAG],
    security,
    request: { params: docs.listParams },
    responses: {
      200: {
        description: 'The post-submission actions configurable here, with their settings',
        content: { 'application/json': { schema: docs.list } },
      },
      403: { description: docs.forbidden },
      404: { description: LIST_NOT_FOUND },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${docs.path}/{code}`,
    tags: [TAG],
    security,
    request: { params: ActionParamsSchema },
    responses: {
      200: {
        description: "One action's settings",
        content: { 'application/json': { schema: docs.settings } },
      },
      400: { description: BAD_CODE },
      403: { description: docs.forbidden },
      404: { description: NOT_FOUND },
    },
  });
  registry.registerPath({
    method: 'put',
    path: `${docs.path}/{code}`,
    tags: [TAG],
    security,
    request: {
      params: ActionParamsSchema,
      body: { content: { 'application/json': { schema: docs.body } } },
    },
    responses: {
      200: {
        description: "The action's settings after the save",
        content: { 'application/json': { schema: docs.settings } },
      },
      400: {
        description:
          "Validation error, including options the action's schema refuses and a form's own values for an action set for the workspace only",
      },
      403: { description: docs.forbidden },
      404: { description: NOT_FOUND },
      409: { description: 'The settings changed after the version this save names' },
    },
  });
};

export const registerPostSubmissionSettingsOpenApi: RegisterOpenApiPaths = (registry) => {
  registerScope(registry, {
    path: '/design/forms/{id}/settings/post-submission',
    listParams: FormSettingsParamsSchema,
    list: FormActionListSchema,
    settings: FormActionSettingsSchema,
    body: SetFormActionBodySchema,
    forbidden: 'Requires form_update',
  });
  registerScope(registry, {
    path: '/workspaces/{id}/settings/post-submission',
    listParams: WorkspaceSettingsParamsSchema,
    list: WorkspaceActionListSchema,
    settings: WorkspaceActionSettingsSchema,
    body: SetWorkspaceActionBodySchema,
    forbidden: 'Workspace management requires an owner or admin role',
  });
};
