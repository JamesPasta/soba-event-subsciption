import { audienceSection, workspaceAudienceSection } from './audience';
import { formSection } from './form';
import { profileSection } from './profile';
import { reviewSection, workspaceReviewSection } from './review';
import { submitterSection, workspaceSubmitterSection } from './submitter';
import { templatesSection } from './templates';
import type { FormSettingsSection, WorkspaceSettingsSection } from './types';

/** Every section of a form's Settings tab, lowest weight first. Add a section here to show it. */
export const formSettingsSections: FormSettingsSection[] = [
  formSection,
  profileSection,
  audienceSection,
  submitterSection,
  reviewSection,
  templatesSection,
].sort((a, b) => a.weight - b.weight);

/** Every section of a workspace's Form Settings tab, lowest weight first. */
export const workspaceSettingsSections: WorkspaceSettingsSection[] = [
  workspaceAudienceSection,
  workspaceSubmitterSection,
  workspaceReviewSection,
].sort((a, b) => a.weight - b.weight);
