import type { ClaimedJob } from '../../../src/core/db/repos/jobRepo';
import { reactionJob } from '../../../src/features/submission-review/fanOut';

jest.mock('../../../src/core/db/client', () => ({ db: {}, quietDb: {} }));
jest.mock('../../../src/features/notifications/service', () => ({ notificationService: {} }));

const CHANGE_ID = '0190f3a2-7c1e-7a4b-9d2e-5f6a7b8c9d0e';

describe('reactionJob', () => {
  const parent = {
    id: 'parent-job',
    workspaceId: 'ws1',
    formId: 'f1',
    submissionId: 's1',
    revisionId: null,
    createdBy: 'rev-1',
  } as ClaimedJob;

  it("is the status-changed job's child, deduped per reaction and change, with the recorded options", () => {
    expect(
      reactionJob(
        parent,
        CHANGE_ID,
        { code: 'submission.status-email', options: { attachComment: true } },
        8,
      ),
    ).toEqual({
      type: 'submission.status-email',
      workspaceId: 'ws1',
      formId: 'f1',
      submissionId: 's1',
      parentJobId: 'parent-job',
      createdBy: 'rev-1',
      params: { attachComment: true, statusChangeId: CHANGE_ID },
      dedupeKey: `submission.status-email:${CHANGE_ID}`,
      maxAttempts: 8,
    });
  });

  it('keeps the change id from the event, whatever the options carry', () => {
    const job = reactionJob(
      parent,
      CHANGE_ID,
      { code: 'submission.status-email', options: { statusChangeId: 'other' } },
      8,
    );
    expect(job.params).toEqual({ statusChangeId: CHANGE_ID });
  });
});
