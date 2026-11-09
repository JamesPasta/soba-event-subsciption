import { z } from 'zod';

export const postSubmissionActionPluginDefinition = {
  code: 'post-submission-test-echo',
  metadata: { code: 'post-submission-test-echo', name: 'Test echo' },
  scopes: ['workspace', 'form'],
  optionsSchema: z.object({ note: z.string() }),
  job: { pool: 'light', run: () => Promise.resolve() },
};
