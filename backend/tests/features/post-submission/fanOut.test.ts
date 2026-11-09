import type { Logger } from 'pino';
import type { ClaimedJob } from '../../../src/core/db/repos/jobRepo';
import type { JobContext } from '../../../src/core/jobs/registry';
import { getJobSettings } from '../../../src/core/jobs/settings';
import { JobCancelledError } from '../../../src/core/jobs/settlement';
import {
  childAttempts,
  childJob,
  fanOutSubmitted,
} from '../../../src/features/post-submission/fanOut';
import type { SubmittedAction } from '../../../src/features/post-submission/resolve';

const mockTransaction = jest.fn();
jest.mock('../../../src/core/db/client', () => ({
  db: { transaction: (...args: unknown[]) => mockTransaction(...args) },
  quietDb: {},
}));
const mockIsLive = jest.fn();
jest.mock('../../../src/features/post-submission/repo', () => ({
  ...jest.requireActual('../../../src/features/post-submission/repo'),
  isSubmissionLive: (...args: unknown[]) => mockIsLive(...args),
}));

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

describe('fanOutSubmitted', () => {
  it('ends cancelled, queuing nothing, once the submission, its form or its workspace is gone', async () => {
    mockIsLive.mockResolvedValue(false);
    const run = fanOutSubmitted({
      job: {
        id: 'parent-job',
        workspaceId: 'ws1',
        submissionId: 's1',
        revisionId: 'r9',
        params: { actions: [action('post-submission-a')] },
      } as unknown as ClaimedJob,
      log: { info: jest.fn() } as unknown as Logger,
    } as unknown as JobContext);

    await expect(run).rejects.toThrow(
      new JobCancelledError('The submission, its form or its workspace is gone'),
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
