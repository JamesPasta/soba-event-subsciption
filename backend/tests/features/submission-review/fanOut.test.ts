const TX = { tx: true };
jest.mock('../../../src/core/db/client', () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(TX) },
  quietDb: {},
}));
jest.mock('../../../src/features/notifications/service', () => ({ notificationService: {} }));
const mockInsertJob = jest.fn();
const mockMarkChildrenQueued = jest.fn();
jest.mock('../../../src/core/db/repos/jobRepo', () => ({
  insertJob: (...args: unknown[]) => mockInsertJob(...args),
  markChildrenQueued: (...args: unknown[]) => mockMarkChildrenQueued(...args),
}));
const mockIsLive = jest.fn();
jest.mock('../../../src/features/post-submission/repo', () => ({
  isSubmissionLive: (...args: unknown[]) => mockIsLive(...args),
}));

import type { Logger } from 'pino';
import type { ClaimedJob } from '../../../src/core/db/repos/jobRepo';
import type { JobContext } from '../../../src/core/jobs/registry';
import { fanOutStatusChanged, reactionJob } from '../../../src/features/submission-review/fanOut';

const CHANGE_ID = '0190f3a2-7c1e-7a4b-9d2e-5f6a7b8c9d0e';
const STATUS_EMAIL = { code: 'submission.status-email', options: { attachComment: true } };

const parent = {
  id: 'parent-job',
  workspaceId: 'ws1',
  formId: 'f1',
  submissionId: 's1',
  revisionId: null,
  createdBy: 'rev-1',
  claimToken: 'claim-1',
} as ClaimedJob;

const fanOut = (actions: unknown[]) =>
  fanOutStatusChanged({
    job: { ...parent, params: { statusChangeId: CHANGE_ID, actions } },
    log: { info: jest.fn() } as unknown as Logger,
  } as unknown as JobContext);

beforeEach(() => {
  jest.clearAllMocks();
  mockIsLive.mockResolvedValue(true);
  mockMarkChildrenQueued.mockResolvedValue(true);
  mockInsertJob.mockResolvedValue('child-job');
});

describe('reactionJob', () => {
  it("is the status-changed job's child, deduped per reaction and change, with the recorded options", () => {
    expect(reactionJob(parent, CHANGE_ID, STATUS_EMAIL, 8)).toEqual({
      type: 'submission.status-email',
      workspaceId: 'ws1',
      formId: 'f1',
      submissionId: 's1',
      parentJobId: 'parent-job',
      createdBy: 'rev-1',
      params: { statusChangeId: CHANGE_ID, options: { attachComment: true } },
      dedupeKey: `submission.status-email:${CHANGE_ID}`,
      maxAttempts: 8,
    });
  });
});

describe('fanOutStatusChanged', () => {
  it('queues each recorded reaction, and marks the event, in one transaction', async () => {
    await fanOut([STATUS_EMAIL]);

    expect(mockMarkChildrenQueued).toHaveBeenCalledWith(TX, 'parent-job', 'claim-1');
    expect(mockInsertJob).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        type: 'submission.status-email',
        params: { statusChangeId: CHANGE_ID, options: { attachComment: true } },
        maxAttempts: 8,
      }),
    );
  });

  it('reads nothing more for a change that recorded no reactions', async () => {
    await fanOut([]);
    expect(mockIsLive).not.toHaveBeenCalled();
    expect(mockInsertJob).not.toHaveBeenCalled();
  });

  it('queues nothing once the submission, its form or its workspace is gone', async () => {
    mockIsLive.mockResolvedValue(false);
    await fanOut([STATUS_EMAIL]);
    expect(mockMarkChildrenQueued).not.toHaveBeenCalled();
    expect(mockInsertJob).not.toHaveBeenCalled();
  });

  it('queues nothing, and fails so the job retries, when it no longer holds the job', async () => {
    mockMarkChildrenQueued.mockResolvedValue(false);
    await expect(fanOut([STATUS_EMAIL])).rejects.toThrow('The job is no longer held');
    expect(mockInsertJob).not.toHaveBeenCalled();
  });
});
