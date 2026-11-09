// Refused at discovery: its options schema cannot parse.
export const postSubmissionActionPluginDefinition = {
  code: 'post-submission-test-no-schema',
  metadata: { code: 'post-submission-test-no-schema', name: 'Test, no schema' },
  scopes: ['form'],
  optionsSchema: {},
  job: { pool: 'light', run: () => Promise.resolve() },
};
