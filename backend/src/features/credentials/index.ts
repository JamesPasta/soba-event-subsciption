import { API_KEY_SETTINGS_KEY } from '@soba/lib';
import { Features } from '../../core/db/codes';
import {
  credentialAudit,
  credentialTypeAssignments,
  workspaceCredentials,
} from '../../core/db/schema';
import { apiKeySettingsRouter } from './routes';
import { registerApiKeySettingsOpenApi } from './schema';
import type { FormSettingsModule } from '../form-settings/types';

// Keys are generated one at a time, so a new form or workspace needs no row.
const noRows = (): Promise<void> => Promise.resolve();

/** API keys of a workspace and of each of its forms. */
export const apiKeySettingsModule: FormSettingsModule = {
  key: API_KEY_SETTINGS_KEY,
  weight: 40,
  featureCode: Features.api_keys,
  router: () => apiKeySettingsRouter('form'),
  registerOpenApi: registerApiKeySettingsOpenApi,
  tables: [credentialAudit, credentialTypeAssignments, workspaceCredentials],
  createForForm: noRows,
  workspace: {
    router: () => apiKeySettingsRouter('workspace'),
    createForWorkspace: noRows,
  },
};
