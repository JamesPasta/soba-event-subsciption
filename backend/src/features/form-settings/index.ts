import type { RegisterOpenApiPaths } from '../../core/api/shared/openapi';
import { formSettingsModules } from './registry';

export { formSettingsRouter, workspaceSettingsRouter } from './router';
export { createFormSettings, createWorkspaceSettings } from './create';
export { formSettingsModules } from './registry';
export type {
  FormSettingsModule,
  SettingsRowInput,
  WorkspaceScopedTable,
  WorkspaceSettingsScope,
} from './types';

export const registerFormSettingsOpenApi: RegisterOpenApiPaths = (registry) => {
  for (const module of formSettingsModules) {
    module.registerOpenApi(registry);
  }
};
