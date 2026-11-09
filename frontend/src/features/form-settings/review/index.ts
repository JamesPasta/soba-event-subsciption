import type { FormSettingsSection, WorkspaceSettingsSection } from '../types';
import ReviewSettingsDrawer from './ReviewSettingsDrawer';
import WorkspaceReviewDrawer from './WorkspaceReviewDrawer';

/** How the form's submissions are reviewed. */
export const reviewSection: FormSettingsSection = {
  id: 'review-settings',
  weight: 35,
  Drawer: ReviewSettingsDrawer,
};

/** How submissions are reviewed on the workspace's forms, unless a form sets its own. */
export const workspaceReviewSection: WorkspaceSettingsSection = {
  id: 'workspace-review',
  weight: 30,
  Drawer: WorkspaceReviewDrawer,
};
