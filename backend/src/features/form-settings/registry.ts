import type { FormSettingsModule } from './types';
import { audienceSettingsModule } from './audience';
import { submitterSettingsModule } from './submitter';
import { postSubmissionSettingsModule } from '../post-submission/settings';
import { apiKeySettingsModule } from '../credentials';

/** Every form settings group, lowest weight first. Add a group here to mount it. */
export const formSettingsModules: FormSettingsModule[] = [
  audienceSettingsModule,
  submitterSettingsModule,
  postSubmissionSettingsModule,
  apiKeySettingsModule,
].sort((a, b) => a.weight - b.weight);
