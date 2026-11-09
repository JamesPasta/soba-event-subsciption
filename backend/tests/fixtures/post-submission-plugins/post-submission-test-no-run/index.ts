import { z } from 'zod';

// Refused at discovery: its job has nothing to run.
export const postSubmissionActionPluginDefinition = {
  code: 'post-submission-test-no-run',
  metadata: { code: 'post-submission-test-no-run', name: 'Test, no run' },
  scopes: ['form'],
  optionsSchema: z.object({}),
  job: { pool: 'light' },
};
