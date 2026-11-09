import { SubmissionReviewStatuses } from '@soba/lib';
import type { ClaimedJob } from '../../../src/core/db/repos/jobRepo';
import {
  queuesSubmittedJob,
  statusChangedJob,
  type StatusChangeEvent,
} from '../../../src/core/jobs/enqueue';
import { StatusEmailJobParamsSchema } from '../../../src/core/jobs/submissionStatusEmail';
import { reactionJob } from '../../../src/features/submission-review/fanOut';
import { StatusChangedJobParamsSchema } from '../../../src/features/submission-review/params';
import { STATUS_REACTIONS } from '../../../src/features/submission-review/statusReactions';

jest.mock('../../../src/core/db/client', () => ({ db: {}, quietDb: {} }));
jest.mock('../../../src/features/notifications/service', () => ({ notificationService: {} }));

const CHANGE_ID = '0190f3a2-7c1e-7a4b-9d2e-5f6a7b8c9d0e';

describe('queuesSubmittedJob', () => {
  it('queues a submit where post-submission is available', async () => {
    await expect(queuesSubmittedJob('submitted', () => Promise.resolve(true))).resolves.toBe(true);
  });

  it('does not queue a submit where post-submission is not available', async () => {
    await expect(queuesSubmittedJob('submitted', () => Promise.resolve(false))).resolves.toBe(
      false,
    );
  });

  it('never queues a save, and does not check availability for one', async () => {
    const isAvailable = jest.fn().mockResolvedValue(true);
    await expect(queuesSubmittedJob('saved', isAvailable)).resolves.toBe(false);
    expect(isAvailable).not.toHaveBeenCalled();
  });
});

describe('statusChangedJob', () => {
  const change: StatusChangeEvent = {
    id: CHANGE_ID,
    workspaceId: 'ws1',
    formId: 'f1',
    submissionId: 's1',
    status: SubmissionReviewStatuses.completed,
    assigneeId: null,
    actorId: 'rev-1',
    bySubmitter: false,
    attachComment: true,
  };

  it('records reactions its fan-out reads, which queue jobs their handler reads', () => {
    const event = statusChangedJob(change, STATUS_REACTIONS);
    expect(event).toMatchObject({
      type: 'submission.status-changed',
      submissionId: 's1',
      createdBy: 'rev-1',
      dedupeKey: `submission.status-changed:${CHANGE_ID}`,
    });

    const { statusChangeId, actions } = StatusChangedJobParamsSchema.parse(event.params);
    expect(actions).toEqual([
      { code: 'submission.status-email', options: { attachComment: true } },
    ]);
    const child = reactionJob(
      { id: 'event-1', ...event } as ClaimedJob,
      statusChangeId,
      actions[0],
      8,
    );
    expect(StatusEmailJobParamsSchema.parse(child.params)).toEqual({
      statusChangeId: CHANGE_ID,
      options: { attachComment: true },
    });
  });

  it('records no reaction for a submitter sending their own submission back to revise', () => {
    const event = statusChangedJob(
      { ...change, status: SubmissionReviewStatuses.revising, bySubmitter: true },
      STATUS_REACTIONS,
    );
    expect(StatusChangedJobParamsSchema.parse(event.params).actions).toEqual([]);
  });
});
