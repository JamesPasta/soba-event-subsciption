const mockChange = jest.fn();
const mockSubmitters = jest.fn();
const mockUserEmail = jest.fn();
jest.mock('../../../src/core/db/repos/submissionReviewRepo', () => ({
  findStatusChangeForEmail: (...args: unknown[]) => mockChange(...args),
  findOtherSubmitters: (...args: unknown[]) => mockSubmitters(...args),
  findUserEmail: (...args: unknown[]) => mockUserEmail(...args),
}));
jest.mock('../../../src/core/db/client', () => ({ db: {} }));
const mockLive = jest.fn();
jest.mock('../../../src/features/post-submission/repo', () => ({
  SUBMISSION_GONE: 'The submission, its form or its workspace is gone',
  findLiveSubmission: (...args: unknown[]) => mockLive(...args),
}));
const mockCanReview = jest.fn();
jest.mock('../../../src/features/submission-review/assignee', () => ({
  canReviewForm: (...args: unknown[]) => mockCanReview(...args),
}));
const mockJobNotifications = jest.fn();
jest.mock('../../../src/features/notifications/jobNotifications', () => ({
  jobNotifications: (...args: unknown[]) => mockJobNotifications(...args),
}));
jest.mock('../../../src/core/config/env', () => ({
  JobPool: { light: 'light', heavy: 'heavy' },
  env: {
    getDesignerAppUrl: () => 'https://design.example',
    getFormsAppUrl: () => 'https://forms.example',
  },
}));

import type { Logger } from 'pino';
import type { ClaimedJob } from '../../../src/core/db/repos/jobRepo';
import type { SendEmail } from '../../../src/core/integrations/notification/NotificationAdapter';
import type { JobNotifications } from '../../../src/core/integrations/notification/JobNotifications';
import type { JobContext } from '../../../src/core/jobs/registry';
import { JobCancelledError } from '../../../src/core/jobs/settlement';
import { runStatusEmailJob } from '../../../src/features/submission-review/statusEmailJob';

const CHANGE_ID = '0190f3a2-7c1e-7a4b-9d2e-5f6a7b8c9d0e';
const ASSIGNED = {
  workspaceId: 'ws1',
  submissionId: 's1',
  status: 'ASSIGNED',
  assigneeId: 'u-grace',
  changedBy: 'rev-1',
  current: true,
  comment: null,
};
const SUBMISSION = {
  id: 's1',
  formId: 'f1',
  formName: 'Permit application',
  workspaceId: 'ws1',
  workspaceName: 'Permits',
  confirmationCode: 'K7M2Q9XA',
};
const SUBMITTERS = { count: 2, emails: ['sub@example.com', 'collab@example.com'] };

let emails: SendEmail[] = [];

const run = (job: Partial<ClaimedJob> = {}, options = { attachComment: false }) =>
  runStatusEmailJob({
    job: {
      id: 'job-1',
      workspaceId: 'ws1',
      submissionId: 's1',
      createdBy: 'rev-1',
      lastRequeuedBy: null,
      lastRequeuedAt: null,
      params: { statusChangeId: CHANGE_ID, options },
      ...job,
    } as ClaimedJob,
    signal: new AbortController().signal,
    log: { info: jest.fn(), warn: jest.fn() } as unknown as Logger,
  } as unknown as JobContext);

/** The actor the job's sends are attributed to. */
const actor = async (): Promise<string> => {
  const [, actorId] = mockJobNotifications.mock.calls[0] as [ClaimedJob, () => Promise<string>];
  return actorId();
};

beforeEach(() => {
  jest.clearAllMocks();
  emails = [];
  mockChange.mockResolvedValue(ASSIGNED);
  mockLive.mockResolvedValue(SUBMISSION);
  mockSubmitters.mockResolvedValue(SUBMITTERS);
  mockUserEmail.mockResolvedValue('grace@example.com');
  mockCanReview.mockResolvedValue(true);
  mockJobNotifications.mockImplementation(
    (): JobNotifications => ({
      enabled: () => Promise.resolve(true),
      sendEmail: (email) => {
        emails.push(email);
        return Promise.resolve({ outcome: 'accepted', httpStatus: null, audited: true });
      },
      handled: () =>
        Promise.resolve({ recipients: new Set<string>(), runStarted: false, anySent: false }),
      sentSince: () => Promise.resolve(0),
    }),
  );
});

it('emails the assignee in both languages, as the reviewer who made the change', async () => {
  await run();

  expect(mockChange).toHaveBeenCalledWith(CHANGE_ID);
  expect(mockLive).toHaveBeenCalledWith({}, { workspaceId: 'ws1', submissionId: 's1' });
  expect(mockCanReview).toHaveBeenCalledWith('ws1', 'f1', 'u-grace');
  expect(emails.map((email) => email.recipients.to)).toEqual([['grace@example.com']]);
  expect(emails[0].content.subject).toBe(
    'Permit application Submission Assignment / Attribution de soumission : Permit application (K7M2Q9XA)',
  );
  expect(emails[0].content.body).toContain(
    'href="https://design.example/fr/build/f1/submissions/s1"',
  );
  await expect(actor()).resolves.toBe('rev-1');
});

it('attributes a re-run to whoever ran the job again', async () => {
  await run({ lastRequeuedBy: 'admin-1' });
  await expect(actor()).resolves.toBe('admin-1');
});

it.each([
  ['the change is gone', null],
  ['the change belongs to another submission', { ...ASSIGNED, submissionId: 's2' }],
  ['the change belongs to another workspace', { ...ASSIGNED, workspaceId: 'ws2' }],
])('ends cancelled when %s', async (_case, change) => {
  mockChange.mockResolvedValue(change);
  await expect(run()).rejects.toThrow(new JobCancelledError('The status change is gone'));
  expect(emails).toEqual([]);
});

// A deleted submission keeps its status, so it is named as gone, not as moved on.
it('ends cancelled, sending nothing, once the submission, its form or its workspace is gone', async () => {
  mockLive.mockResolvedValue(null);
  await expect(run()).rejects.toThrow(
    new JobCancelledError('The submission, its form or its workspace is gone'),
  );
  expect(emails).toEqual([]);
});

it('ends cancelled, sending nothing, when the status has moved on', async () => {
  mockChange.mockResolvedValue({ ...ASSIGNED, current: false });
  await expect(run()).rejects.toThrow(
    new JobCancelledError('The status has changed since; no email sent'),
  );
  expect(mockUserEmail).not.toHaveBeenCalled();
  expect(emails).toEqual([]);
});

it('ends cancelled for a status that sends no email', async () => {
  mockChange.mockResolvedValue({ ...ASSIGNED, status: 'SUBMITTED', assigneeId: null });
  await expect(run()).rejects.toThrow(new JobCancelledError('This status sends no email'));
});

it.each([
  [
    'the reviewer assigned it to themselves',
    () => mockChange.mockResolvedValue({ ...ASSIGNED, assigneeId: 'rev-1' }),
    'Assigned to the person who made the change; no email sent',
  ],
  [
    'no one was assigned',
    () => mockChange.mockResolvedValue({ ...ASSIGNED, assigneeId: null }),
    'No one was assigned',
  ],
  [
    'the assignee can no longer review the form',
    () => mockCanReview.mockResolvedValue(false),
    'The assignee can no longer review this form',
  ],
  [
    'the assignee has no email address',
    () => mockUserEmail.mockResolvedValue(null),
    'The assignee has no email address',
  ],
])('ends cancelled, with the reason, when %s', async (_case, arrange, reason) => {
  arrange();
  await expect(run()).rejects.toThrow(new JobCancelledError(reason));
  expect(emails).toEqual([]);
});

it('emails each submitter, with the comment only when it was attached', async () => {
  mockChange.mockResolvedValue({
    ...ASSIGNED,
    status: 'REVISING',
    assigneeId: null,
    comment: 'Please attach the signed declaration.',
  });

  await run({}, { attachComment: true });
  expect(emails.map((email) => email.recipients.to)).toEqual([
    ['sub@example.com'],
    ['collab@example.com'],
  ]);
  expect(emails[0].content.body).toContain('Please attach the signed declaration.');
  expect(emails[0].content.body).toContain('href="https://forms.example/en/submit/s1"');

  emails = [];
  await run({}, { attachComment: false });
  expect(emails[0].content.body).not.toContain('Please attach the signed declaration.');
});

it.each([
  [
    'no submitter other than the reviewer',
    { count: 0, emails: [] },
    'No submitter other than the person who made the change',
  ],
  [
    'no other submitter with an email address',
    { count: 2, emails: [] },
    'None of the submitters has an email address',
  ],
])('ends cancelled, with the reason, when there is %s', async (_case, submitters, reason) => {
  mockChange.mockResolvedValue({ ...ASSIGNED, status: 'COMPLETED', assigneeId: null });
  mockSubmitters.mockResolvedValue(submitters);
  await expect(run()).rejects.toThrow(new JobCancelledError(reason));
  expect(mockSubmitters).toHaveBeenCalledWith('s1', 'rev-1');
  expect(emails).toEqual([]);
});
