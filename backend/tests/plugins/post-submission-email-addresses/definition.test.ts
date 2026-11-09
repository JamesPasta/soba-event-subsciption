import { findPostSubmissionAction } from '../../../src/core/integrations/post-submission-action/PostSubmissionActionRegistry';
import { postSubmissionActionPluginDefinition as plugin } from '../../../src/plugins/post-submission-email-addresses';

const saved = process.env.POST_SUBMISSION_ACTION_PLUGINS;

beforeAll(() => {
  process.env.POST_SUBMISSION_ACTION_PLUGINS = 'post-submission-email-addresses';
});

afterAll(() => {
  if (saved === undefined) delete process.env.POST_SUBMISSION_ACTION_PLUGINS;
  else process.env.POST_SUBMISSION_ACTION_PLUGINS = saved;
});

describe('post-submission-email-addresses', () => {
  it('is discovered from the plugins folder and enabled by its code', () => {
    expect(findPostSubmissionAction('post-submission-email-addresses')).toMatchObject({
      featureCode: 'post-submission-email',
      scopes: ['workspace', 'form'],
    });
  });

  it('retries for about an hour in the light pool', () => {
    expect(plugin.job).toMatchObject({ pool: 'light', maxAttempts: 8, timeoutMs: 300_000 });
  });
});
