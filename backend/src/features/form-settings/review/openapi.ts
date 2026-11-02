import { REVIEW_SETTINGS_KEY, ReviewSettingsSchema } from '@soba/lib';
import type { RegisterOpenApiPaths } from '../../../core/api/shared/openapi';
import { inheritableOpenApiSchemas, registerInheritableSettingsPaths } from '../schema';

const schemas = inheritableOpenApiSchemas(ReviewSettingsSchema, 'Review');

export const WorkspaceReviewSettingsSchema = schemas.workspace;
export const SetFormReviewSettingsBodySchema = schemas.formBody;

export const registerReviewSettingsOpenApi: RegisterOpenApiPaths = (registry) =>
  registerInheritableSettingsPaths(registry, {
    key: REVIEW_SETTINGS_KEY,
    label: 'review settings',
    schemas,
  });
