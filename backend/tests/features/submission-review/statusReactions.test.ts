const mockNotificationsEnabled = jest.fn();
jest.mock('../../../src/features/notifications/service', () => ({
  notificationService: { enabled: () => mockNotificationsEnabled() },
}));

import { SubmissionReviewStatuses } from '@soba/lib';
import { getJobSettings } from '../../../src/core/jobs/settings';
import {
  availableStatusReactions,
  chooseStatusReactions,
  reactionAttempts,
  STATUS_REACTIONS,
  type StatusChangeFacts,
} from '../../../src/features/submission-review/statusReactions';

const FACTS: StatusChangeFacts = {
  status: SubmissionReviewStatuses.assigned,
  assigneeId: 'u-grace',
  actorId: 'rev-1',
  bySubmitter: false,
  attachComment: false,
};

const STATUS_EMAIL = { code: 'submission.status-email', options: { attachComment: false } };

beforeEach(() => {
  jest.clearAllMocks();
  mockNotificationsEnabled.mockResolvedValue(true);
});

describe('status reactions', () => {
  it.each([
    SubmissionReviewStatuses.assigned,
    SubmissionReviewStatuses.revising,
    SubmissionReviewStatuses.completed,
  ])('records the status email for a reviewer moving a submission to %s', (status) => {
    const assigneeId = status === SubmissionReviewStatuses.assigned ? 'u-grace' : null;
    expect(chooseStatusReactions({ ...FACTS, status, assigneeId }, STATUS_REACTIONS)).toEqual([
      STATUS_EMAIL,
    ]);
  });

  it("records the reviewer's choice to put their comment in the email", () => {
    expect(chooseStatusReactions({ ...FACTS, attachComment: true }, STATUS_REACTIONS)).toEqual([
      { ...STATUS_EMAIL, options: { attachComment: true } },
    ]);
  });

  it.each([
    ['moving a submission to Submitted', { status: SubmissionReviewStatuses.submitted }],
    ['an assignment to the person who made it', { assigneeId: 'rev-1' }],
    [
      'a submitter sending their own submission back to revise',
      { status: SubmissionReviewStatuses.revising, assigneeId: null, bySubmitter: true },
    ],
  ])('records no status email for %s', (_case, change) => {
    expect(chooseStatusReactions({ ...FACTS, ...change }, STATUS_REACTIONS)).toEqual([]);
  });

  it('leaves out a reaction that cannot run here, such as the email with notifications off', async () => {
    mockNotificationsEnabled.mockResolvedValue(false);
    await expect(availableStatusReactions()).resolves.toEqual([]);

    mockNotificationsEnabled.mockResolvedValue(true);
    await expect(availableStatusReactions()).resolves.toEqual([...STATUS_REACTIONS]);
  });

  it("gives a reaction's job its own attempts, and JOB_MAX_ATTEMPTS to a code it does not know", () => {
    expect(reactionAttempts('submission.status-email')).toBe(8);
    expect(reactionAttempts('submission.newer-reaction')).toBe(getJobSettings().maxAttempts);
  });
});
