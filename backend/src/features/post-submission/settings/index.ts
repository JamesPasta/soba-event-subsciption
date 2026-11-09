import { Features } from '../../../core/db/codes';
import { postSubmissionActionSettings } from '../../../core/db/schema';
import type { FormSettingsModule } from '../../form-settings/types';
import { registerPostSubmissionSettingsOpenApi } from './openapi';
import { postSubmissionSettingsRouter } from './routes';

// Rows are created by their first save, so a new form or workspace needs none.
const noRows = (): Promise<void> => Promise.resolve();

/** Post-submission action settings, per action, for a workspace's forms and for each form. */
export const postSubmissionSettingsModule: FormSettingsModule = {
  key: 'post-submission',
  weight: 30,
  featureCode: Features.post_submission,
  router: () => postSubmissionSettingsRouter('form'),
  registerOpenApi: registerPostSubmissionSettingsOpenApi,
  tables: [postSubmissionActionSettings],
  createForForm: noRows,
  workspace: {
    router: () => postSubmissionSettingsRouter('workspace'),
    createForWorkspace: noRows,
  },
};
