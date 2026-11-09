import { SUBMITTER_SETTINGS_KEY } from '@soba/lib';
import { formSubmitterSettings, workspaceSubmitterSettings } from '../../../core/db/schema';
import { settingsRoutes } from '../routes';
import type { FormSettingsModule } from '../types';
import {
  registerSubmitterSettingsOpenApi,
  SetFormSubmitterSettingsBodySchema,
  WorkspaceSubmitterSettingsSchema,
} from './openapi';
import { formSubmitterSettingsService, workspaceSubmitterSettingsService } from './service';
import { createSubmitterSettings, createWorkspaceSubmitterSettings } from './repo';

export { formSubmitterSettingsService, workspaceSubmitterSettingsService } from './service';

export const submitterSettingsModule: FormSettingsModule = {
  key: SUBMITTER_SETTINGS_KEY,
  weight: 10,
  router: () => settingsRoutes(formSubmitterSettingsService, SetFormSubmitterSettingsBodySchema),
  registerOpenApi: registerSubmitterSettingsOpenApi,
  tables: [formSubmitterSettings, workspaceSubmitterSettings],
  createForForm: createSubmitterSettings,
  workspace: {
    router: () =>
      settingsRoutes(
        workspaceSubmitterSettingsService,
        WorkspaceSubmitterSettingsSchema,
        'workspace',
      ),
    createForWorkspace: createWorkspaceSubmitterSettings,
  },
};
