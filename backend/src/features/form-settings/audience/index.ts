import { AUDIENCE_SETTINGS_KEY } from '@soba/lib';
import { createWorkspaceAudienceSetting } from '../../../core/db/repos/audienceSettingRepo';
import { formAudienceSettings, workspaceAudienceSettings } from '../../../core/db/schema';
import { settingsRoutes } from '../routes';
import type { FormSettingsModule } from '../types';
import { registerAudienceSettingsOpenApi, SetFormAudienceSettingsBodySchema } from './openapi';
import { createFormAudience, formAudienceService } from './service';
import { workspaceAudienceRoutes } from './routes';

export { formAudienceService, workspaceAudienceService } from './service';

export const audienceSettingsModule: FormSettingsModule = {
  key: AUDIENCE_SETTINGS_KEY,
  weight: 5,
  router: () => settingsRoutes(formAudienceService, SetFormAudienceSettingsBodySchema),
  registerOpenApi: registerAudienceSettingsOpenApi,
  tables: [formAudienceSettings, workspaceAudienceSettings],
  createForForm: createFormAudience,
  workspace: {
    router: workspaceAudienceRoutes,
    createForWorkspace: createWorkspaceAudienceSetting,
  },
};
