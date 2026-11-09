import type { Dictionary } from '@/src/types/dictionary';

/** Whether an action is on, as a line of text. */
export const statusText = (dict: Dictionary, enabled: boolean): string =>
  dict.postSubmission.status.replace(
    '{status}',
    enabled ? dict.postSubmission.on : dict.postSubmission.off,
  );
