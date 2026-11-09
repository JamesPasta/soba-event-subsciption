import { z } from 'zod';

// Refused at discovery: a code must be lowercase words joined by dashes.
export const postSubmissionActionPluginDefinition = {
  code: 'Bad_Code',
  metadata: { code: 'Bad_Code', name: 'Bad code' },
  scopes: ['form'],
  optionsSchema: z.object({}),
  job: { pool: 'light', run: () => Promise.resolve() },
};
