import type { FormSettingsSection, WorkspaceSettingsSection } from '../types';
import SubmitterSettingsDrawer from './SubmitterSettingsDrawer';
import WorkspaceSubmitterDrawer from './WorkspaceSubmitterDrawer';

/** What the form's submitters may do. */
export const submitterSection: FormSettingsSection = {
  id: 'submitter-settings',
  weight: 30,
  Drawer: SubmitterSettingsDrawer,
};

/** What submitters may do on the workspace's forms, unless a form sets its own. */
export const workspaceSubmitterSection: WorkspaceSettingsSection = {
  id: 'workspace-submitter',
  weight: 20,
  Drawer: WorkspaceSubmitterDrawer,
};
