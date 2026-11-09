import { emailAddressesAction } from './email';
import { logAction } from './log';
import type { PostSubmissionActionUi } from './types';

/** The actions this build has fields for, by plugin code. Add an action here to give it a drawer. */
const actions = new Map<string, PostSubmissionActionUi>([
  ['post-submission-email-addresses', emailAddressesAction],
  ['post-submission-log', logAction],
]);

/** How the tab shows an action; undefined for one this build has no fields for. */
export const postSubmissionActionUi = (code: string): PostSubmissionActionUi | undefined =>
  actions.get(code);

/** The plugin codes this build has fields for. */
export const postSubmissionActionCodes = (): string[] => [...actions.keys()];
