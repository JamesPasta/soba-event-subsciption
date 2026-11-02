import { REVIEW_SETTINGS_KEY } from '@soba/lib';
import { formReviewSettings, workspaceReviewSettings } from '../../../core/db/schema';
import { settingsRoutes } from '../routes';
import type { FormSettingsModule } from '../types';
import {
  registerReviewSettingsOpenApi,
  SetFormReviewSettingsBodySchema,
  WorkspaceReviewSettingsSchema,
} from './openapi';
import { formReviewSettingsService, workspaceReviewSettingsService } from './service';
import { createReviewSettings, createWorkspaceReviewSettings } from './repo';

export { formReviewSettingsService, workspaceReviewSettingsService } from './service';

export const reviewSettingsModule: FormSettingsModule = {
  key: REVIEW_SETTINGS_KEY,
  weight: 20,
  router: () => settingsRoutes(formReviewSettingsService, SetFormReviewSettingsBodySchema),
  registerOpenApi: registerReviewSettingsOpenApi,
  tables: [formReviewSettings, workspaceReviewSettings],
  createForForm: createReviewSettings,
  workspace: {
    router: () =>
      settingsRoutes(workspaceReviewSettingsService, WorkspaceReviewSettingsSchema, 'workspace'),
    createForWorkspace: createWorkspaceReviewSettings,
  },
};
