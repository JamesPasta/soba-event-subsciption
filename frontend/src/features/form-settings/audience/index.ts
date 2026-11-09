import type { FormSettingsSection, WorkspaceSettingsSection } from '../types';
import FormAudienceDrawer from './FormAudienceDrawer';
import WorkspaceAudienceDrawer from './WorkspaceAudienceDrawer';

/** Who can submit the form: the workspace's audience, or the form's own. */
export const audienceSection: FormSettingsSection = {
  id: 'form-audience',
  weight: 25,
  Drawer: FormAudienceDrawer,
};

/** Who can submit the workspace's forms, unless a form sets its own. */
export const workspaceAudienceSection: WorkspaceSettingsSection = {
  id: 'workspace-audience',
  weight: 10,
  Drawer: WorkspaceAudienceDrawer,
};
