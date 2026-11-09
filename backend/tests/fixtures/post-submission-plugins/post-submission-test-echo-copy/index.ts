import { z } from 'zod';

// Takes a code another fixture has; only one of the two is installed.
export const postSubmissionActionPluginDefinition = {
  code: 'post-submission-test-echo',
  metadata: { code: 'post-submission-test-echo', name: 'Test echo, copied' },
  scopes: ['workspace', 'form'],
  optionsSchema: z.object({ note: z.string() }),
  job: { pool: 'light', run: () => Promise.resolve() },
};
