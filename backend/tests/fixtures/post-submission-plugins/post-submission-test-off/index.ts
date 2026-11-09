import { z } from 'zod';

export const postSubmissionActionPluginDefinition = {
  code: 'post-submission-test-off',
  metadata: { code: 'post-submission-test-off', name: 'Test, not enabled' },
  scopes: ['form'],
  optionsSchema: z.object({}),
  job: { pool: 'heavy', run: () => Promise.resolve() },
};
