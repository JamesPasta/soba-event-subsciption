import type { FormSettingsModule } from './types';
import { audienceSettingsModule } from './audience';
import { submitterSettingsModule } from './submitter';
import { reviewSettingsModule } from './review';
import { postSubmissionSettingsModule } from '../post-submission/settings';

/** Every form settings group, lowest weight first. Add a group here to mount it. */
export const formSettingsModules: FormSettingsModule[] = [
  audienceSettingsModule,
  submitterSettingsModule,
  reviewSettingsModule,
  postSubmissionSettingsModule,
].sort((a, b) => a.weight - b.weight);
