import type { ClaimedJob } from '../../../src/core/db/repos/jobRepo';
import { getJobSettings } from '../../../src/core/jobs/settings';
import { childAttempts, childJob } from '../../../src/features/post-submission/fanOut';
import type { SubmittedAction } from '../../../src/features/post-submission/resolve';

jest.mock('../../../src/core/db/client', () => ({ db: {}, quietDb: {} }));

// This pod has post-submission-a installed; it lacks every other plugin.
jest.mock(
  '../../../src/core/integrations/post-submission-action/PostSubmissionActionRegistry',
  () => ({
    findInstalledPostSubmissionAction: (code: string) =>
      code === 'post-submission-a' ? { job: { maxAttempts: 5 } } : undefined,
  }),
);

const action = (code: string): SubmittedAction => ({
  code,
  options: { to: ['a@example.com'] },
  source: { scope: 'form', settingId: `${code}-setting`, version: 3 },
});

describe('childJob', () => {
  const parent = {
    id: 'parent-job',
    workspaceId: 'ws1',
    formId: 'f1',
    submissionId: 's1',
    revisionId: 'r9',
    createdBy: 'actor-1',
  } as ClaimedJob;

  it("is the submitted job's child, deduped per action and revision, with the recorded options", () => {
    expect(childJob(parent, action('post-submission-a'), 5)).toEqual({
      type: 'post-submission-a',
      workspaceId: 'ws1',
      formId: 'f1',
      submissionId: 's1',
      revisionId: 'r9',
      parentJobId: 'parent-job',
      actionConfigId: 'post-submission-a-setting',
      createdBy: 'actor-1',
      params: {
        options: { to: ['a@example.com'] },
        source: { scope: 'form', settingId: 'post-submission-a-setting', version: 3 },
      },
      dedupeKey: 'post-submission-a:r9',
      maxAttempts: 5,
    });
  });
});

describe('childAttempts', () => {
  it("takes the plugin's attempts when this pod has it", () => {
    expect(childAttempts('post-submission-a')).toBe(5);
  });

  it('takes JOB_MAX_ATTEMPTS for an action whose plugin this pod lacks', () => {
    expect(childAttempts('post-submission-newer')).toBe(getJobSettings().maxAttempts);
  });
});
