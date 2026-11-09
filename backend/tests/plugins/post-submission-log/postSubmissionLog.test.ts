import type { Logger } from 'pino';
import type { ClaimedJob } from '../../../src/core/db/repos/jobRepo';
import type { PostSubmissionActionServices } from '../../../src/core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import { findPostSubmissionAction } from '../../../src/core/integrations/post-submission-action/PostSubmissionActionRegistry';
import { postSubmissionActionPluginDefinition as plugin } from '../../../src/plugins/post-submission-log';

const saved = process.env.POST_SUBMISSION_ACTION_PLUGINS;

beforeAll(() => {
  process.env.POST_SUBMISSION_ACTION_PLUGINS = 'post-submission-log';
});

afterAll(() => {
  if (saved === undefined) delete process.env.POST_SUBMISSION_ACTION_PLUGINS;
  else process.env.POST_SUBMISSION_ACTION_PLUGINS = saved;
});

describe('post-submission-log', () => {
  it('is discovered from the plugins folder and enabled by its code', () => {
    expect(findPostSubmissionAction('post-submission-log')?.scopes).toEqual(['workspace', 'form']);
  });

  it('takes an optional short note and nothing else', () => {
    expect(plugin.optionsSchema.safeParse({}).success).toBe(true);
    expect(plugin.optionsSchema.safeParse({ note: 'smoke' }).success).toBe(true);
    expect(plugin.optionsSchema.safeParse({ to: ['a@example.com'] }).success).toBe(false);
    expect(plugin.optionsSchema.safeParse({ note: 'x'.repeat(201) }).success).toBe(false);
  });

  it('logs where it ran from and its option names, not their values', async () => {
    const info = jest.fn();
    const source = { scope: 'form' as const, settingId: 'setting-1', version: 2 };
    await plugin.job.run({
      job: { id: 'job-1', submissionId: 's1', revisionId: 'r1' } as ClaimedJob,
      options: { note: 'private words' },
      source,
      submission: {
        id: 's1',
        formId: 'f1',
        formName: 'Form',
        workspaceId: 'w1',
        workspaceName: 'Workspace',
        confirmationCode: 'ABCDEFGH',
      },
      // The log plugin uses no services.
      services: {} as PostSubmissionActionServices,
      signal: new AbortController().signal,
      log: { info } as unknown as Logger,
    });
    expect(info).toHaveBeenCalledWith(
      { submissionId: 's1', revisionId: 'r1', source, optionKeys: ['note'] },
      'Post-submission log action ran',
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('private words');
  });
});
