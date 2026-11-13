import type { FormSettingsModule } from './types';
import { audienceSettingsModule } from './audience';
import { submitterSettingsModule } from './submitter';
import { reviewSettingsModule } from './review';
import { postSubmissionSettingsModule } from '../post-submission/settings';
import { apiKeySettingsModule } from '../credentials';
import { eventSubscriptionSettingsModule } from './event-subscription';

/** Every form settings group, lowest weight first. Add a group here to mount it. */
export const formSettingsModules: FormSettingsModule[] = [
  audienceSettingsModule,
  submitterSettingsModule,
  reviewSettingsModule,
  postSubmissionSettingsModule,
  apiKeySettingsModule,
  eventSubscriptionSettingsModule,
].sort((a, b) => a.weight - b.weight);
