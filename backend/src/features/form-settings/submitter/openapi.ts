import { SUBMITTER_SETTINGS_KEY, SubmitterSettingsSchema } from '@soba/lib';
import type { RegisterOpenApiPaths } from '../../../core/api/shared/openapi';
import { inheritableOpenApiSchemas, registerInheritableSettingsPaths } from '../schema';

const schemas = inheritableOpenApiSchemas(SubmitterSettingsSchema, 'Submitter');

export const WorkspaceSubmitterSettingsSchema = schemas.workspace;
export const SetFormSubmitterSettingsBodySchema = schemas.formBody;

export const registerSubmitterSettingsOpenApi: RegisterOpenApiPaths = (registry) =>
  registerInheritableSettingsPaths(registry, {
    key: SUBMITTER_SETTINGS_KEY,
    label: 'submitter settings',
    schemas,
  });
