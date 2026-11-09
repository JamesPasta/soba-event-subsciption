import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  AUDIENCE_SETTINGS_KEY,
  AudienceSchema,
  InheritingFormsSchema as LibInheritingFormsSchema,
} from '@soba/lib';
import type { RegisterOpenApiPaths } from '../../../core/api/shared/openapi';
import {
  inheritableOpenApiSchemas,
  registerInheritableSettingsPaths,
  WorkspaceSettingsParamsSchema,
} from '../schema';

extendZodWithOpenApi(z);

const schemas = inheritableOpenApiSchemas(AudienceSchema, 'Audience');

export const WorkspaceAudienceSettingsSchema = schemas.workspace;
export const SetFormAudienceSettingsBodySchema = schemas.formBody;

export const InheritingFormsSchema = LibInheritingFormsSchema.clone().openapi(
  'FormSettings_InheritingForms',
);

export const registerAudienceSettingsOpenApi: RegisterOpenApiPaths = (registry) => {
  registerInheritableSettingsPaths(registry, {
    key: AUDIENCE_SETTINGS_KEY,
    label: 'audience',
    schemas,
  });
  registry.registerPath({
    method: 'get',
    path: `/workspaces/{id}/settings/${AUDIENCE_SETTINGS_KEY}/inheriting-forms`,
    tags: ['core.form-settings'],
    security: [{ bearerAuth: [] }],
    request: { params: WorkspaceSettingsParamsSchema },
    responses: {
      200: {
        description: "How many live forms use the workspace's audience",
        content: { 'application/json': { schema: InheritingFormsSchema } },
      },
      403: { description: 'Actor is not a member of the workspace' },
      404: { description: 'Workspace not found' },
    },
  });
};
