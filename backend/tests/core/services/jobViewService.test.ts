import { JobType } from '../../../src/core/db/codes';
import type { JobListRow, JobRow } from '../../../src/core/db/repos/jobViewRepo';
import { LEASE_EXPIRED } from '../../../src/core/db/repos/jobRepo';
import type { JobNotificationSend } from '../../../src/core/db/repos/notificationAuditRepo';
import {
  countEmails,
  redactAddresses,
  rerunRefusal,
  toJobDetail,
  toJobListItem,
  toStaffJobDetail,
  toStaffJobListItem,
  type LoadedJob,
  type RerunFacts,
} from '../../../src/core/services/jobViewService';

const now = new Date('2026-10-28T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const MINUTE = 60_000;
const DAY = 86_400_000;

const facts = (overrides: Partial<RerunFacts> = {}): RerunFacts => ({
  status: 'dead',
  type: 'post-submission-email-addresses',
  registered: true,
  childCount: 0,
  childrenQueuedAt: null,
  finishedAt: ago(10 * MINUTE),
  lastError: 'Email send failed (status 503) after 1 of 3',
  now,
  leaseMs: MINUTE,
  ...overrides,
});

describe('rerunRefusal', () => {
  it.each(['dead', 'cancelled'])('lets a %s job run again', (status) => {
    expect(rerunRefusal(facts({ status }))).toBeNull();
  });

  it.each(['queued', 'running', 'succeeded'])('refuses a %s job', (status) => {
    expect(rerunRefusal(facts({ status }))).toBe('Only a dead or cancelled job can be run again');
  });

  it('refuses a type this environment does not run', () => {
    expect(rerunRefusal(facts({ registered: false }))).toBe(
      'This environment does not run jobs of this type',
    );
  });

  const received = (overrides: Partial<RerunFacts>) =>
    rerunRefusal(facts({ type: JobType.submission_submitted, ...overrides }));
  const queuedAlready = 'Its actions were queued already; run their jobs again instead';

  it('runs a submission-received job again when it queued no actions', () => {
    expect(received({})).toBeNull();
  });

  it('refuses a submission-received job that queued actions, which would send their emails again', () => {
    expect(received({ childCount: 1 })).toBe(queuedAlready);
  });

  it('refuses a submission-received job whose queued actions were deleted under retention', () => {
    expect(received({ childrenQueuedAt: ago(40 * DAY) })).toBe(queuedAlready);
  });

  // Its fan-out rolled back, so no dedupe key was taken and nothing was sent.
  it('runs a submission-received job again however old, when it never queued its actions', () => {
    expect(received({ finishedAt: ago(60 * DAY) })).toBeNull();
  });

  it.each(['dead', 'cancelled'])(
    'refuses a %s export: its starter starts a new one, under their limit',
    (status) => {
      expect(rerunRefusal(facts({ type: JobType.submission_export, status }))).toBe(
        "Start a new export from the form's Exports page",
      );
    },
  );

  it('refuses a job whose lease expired within the last lease, as it may still be running', () => {
    expect(rerunRefusal(facts({ lastError: LEASE_EXPIRED, finishedAt: ago(MINUTE / 2) }))).toBe(
      'Its last run may still be finishing; try again in a minute',
    );
    expect(
      rerunRefusal(facts({ lastError: LEASE_EXPIRED, finishedAt: ago(2 * MINUTE) })),
    ).toBeNull();
    expect(rerunRefusal(facts({ finishedAt: ago(MINUTE / 2) }))).toBeNull();
  });
});

describe('countEmails', () => {
  const send = (
    to: string,
    outcome: JobNotificationSend['outcome'],
    httpStatus: number | null = null,
  ): JobNotificationSend => ({ outcome, httpStatus, recipients: { to: [to] }, createdAt: now });

  it('counts each address once, by where it stands', () => {
    const counts = countEmails(
      ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'],
      [
        send('a@example.com', 'accepted'),
        send('b@example.com', 'error', 400),
        send('c@example.com', 'error', 503),
        send('d@example.com', 'not_sent'),
        send('a@example.com', 'accepted'),
      ],
    );
    expect(counts).toEqual({ addresses: 5, sent: 2, refused: 1, pending: 2 });
  });

  it('counts an address refused and then accepted as sent', () => {
    expect(
      countEmails(
        ['a@example.com'],
        [send('a@example.com', 'error', 422), send('a@example.com', 'accepted')],
      ),
    ).toEqual({ addresses: 1, sent: 1, refused: 0, pending: 0 });
  });

  it('ignores sends to addresses no longer on the list', () => {
    expect(countEmails(['a@example.com'], [send('z@example.com', 'accepted')])).toEqual({
      addresses: 1,
      sent: 0,
      refused: 0,
      pending: 1,
    });
  });
});

describe('redactAddresses', () => {
  it('replaces each word holding an @, whatever wraps it', () => {
    expect(redactAddresses('Bad address: <a.b+c@example.com>, also x@y')).toBe(
      'Bad address: [address] also [address]',
    );
  });

  it('keeps text without one, and null', () => {
    expect(redactAddresses('Database error 23505 on job_dedupe_key_unique')).toBe(
      'Database error 23505 on job_dedupe_key_unique',
    );
    expect(redactAddresses(null)).toBeNull();
  });
});

const JOB_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
const FORM_ID = '00000000-0000-4000-8000-000000000003';
const SUBMISSION_ID = '00000000-0000-4000-8000-000000000004';
const PARENT_ID = '00000000-0000-4000-8000-000000000005';
const SUBMITTER_ID = '00000000-0000-4000-8000-000000000006';
const MEMBER_ID = '00000000-0000-4000-8000-000000000007';
const ADMIN_ID = '00000000-0000-4000-8000-000000000008';

const listRow = (overrides: Partial<JobListRow> = {}): JobListRow => ({
  id: JOB_ID,
  type: 'post-submission-email-addresses',
  status: 'cancelled',
  attempts: 1,
  maxAttempts: 8,
  workspaceId: WORKSPACE_ID,
  workspaceName: 'Licensing',
  formId: FORM_ID,
  formName: 'Permit',
  submissionId: SUBMISSION_ID,
  confirmationCode: 'AH2N6XHC',
  submissionLive: true,
  createdAt: now,
  runAfter: now,
  finishedAt: now,
  cancelRequestedAt: now,
  requeueCount: 1,
  lastError: 'insert failed for a@example.com',
  ...overrides,
});

const loaded = (overrides: Partial<JobRow> = {}): LoadedJob => ({
  row: {
    ...listRow(),
    revisionId: '00000000-0000-4000-8000-000000000009',
    parentJobId: PARENT_ID,
    params: { options: { to: ['a@example.com', 'b@example.com'] } },
    startedAt: now,
    createdBy: { id: SUBMITTER_ID, displayLabel: 'Submitter' },
    lastRequeuedAt: now,
    lastRequeuedBy: { id: MEMBER_ID, displayLabel: 'Form Admin', member: true, viaAdmin: false },
    cancelRequestedBy: {
      id: ADMIN_ID,
      displayLabel: 'Platform Admin',
      member: false,
      viaAdmin: true,
    },
    childrenQueuedAt: null,
    ...overrides,
  },
  parent: {
    id: PARENT_ID,
    type: JobType.submission_submitted,
    status: 'succeeded',
    createdAt: now,
    finishedAt: now,
  },
  children: [],
  emailCounts: { addresses: 2, sent: 1, refused: 1, pending: 0 },
  output: null,
});

describe('toJobListItem', () => {
  it('returns error text without addresses', () => {
    expect(toJobListItem(listRow())).toMatchObject({
      lastError: 'insert failed for [address]',
      finishedAt: now.toISOString(),
      workspaceId: WORKSPACE_ID,
    });
  });
});

describe('toJobDetail', () => {
  it('names who asked for a stop, as it names who ran it again', () => {
    const detail = toJobDetail(loaded());
    expect(detail.cancelRequestedBy).toEqual({ id: ADMIN_ID, displayLabel: 'Platform Admin' });
    expect(detail.lastRequeuedBy).toEqual({ id: MEMBER_ID, displayLabel: 'Form Admin' });
    expect(detail.optionNames).toEqual(['to']);
  });

  it("gives the result's facts and progress, and leaves both out when there are none", () => {
    const expiresAt = new Date('2026-11-05T12:00:00Z');
    const detail = toJobDetail({
      ...loaded(),
      output: {
        progress: { done: 40, total: 40 },
        result: {
          state: 'ready',
          filename: 'Permit 2026-10-29.csv',
          size: 512,
          contentType: 'text/csv',
          expiresAt,
        },
      },
    });
    expect(detail.progress).toEqual({ done: 40, total: 40 });
    expect(detail.result).toEqual({
      state: 'ready',
      filename: 'Permit 2026-10-29.csv',
      size: 512,
      contentType: 'text/csv',
      expiresAt: expiresAt.toISOString(),
    });
    expect(
      toJobDetail({
        ...loaded(),
        output: { progress: null, result: { state: 'expired', expiresAt } },
      }).result,
    ).toEqual({ state: 'expired', expiresAt: expiresAt.toISOString() });
    const none = toJobDetail(loaded());
    expect(none).not.toHaveProperty('progress');
    expect(none).not.toHaveProperty('result');
  });
});

const STAFF_LIST_KEYS = [
  'attempts',
  'cancelRequestedAt',
  'confirmationCode',
  'createdAt',
  'finishedAt',
  'formName',
  'id',
  'lastError',
  'maxAttempts',
  'requeueCount',
  'runAfter',
  'status',
  'submissionId',
  'type',
];

describe('toStaffJobListItem', () => {
  it('carries no workspace or form id, and error text without addresses', () => {
    const item = toStaffJobListItem(listRow());
    expect(Object.keys(item).sort()).toEqual(STAFF_LIST_KEYS);
    expect(item).toMatchObject({
      formName: 'Permit',
      confirmationCode: 'AH2N6XHC',
      submissionId: SUBMISSION_ID,
      lastError: 'insert failed for [address]',
    });
  });

  it('drops the submission id once its page cannot open', () => {
    expect(toStaffJobListItem(listRow({ submissionLive: false }))).toMatchObject({
      submissionId: null,
      confirmationCode: 'AH2N6XHC',
    });
  });
});

describe('toStaffJobDetail', () => {
  it('carries no workspace, form, revision or user ids, and no option names or values', () => {
    const detail = toStaffJobDetail(loaded());
    expect(Object.keys(detail).sort()).toEqual(
      [
        ...STAFF_LIST_KEYS,
        'cancelRequestedBy',
        'children',
        'childrenQueuedAt',
        'createdBy',
        'emailCounts',
        'lastRequeuedAt',
        'lastRequeuedBy',
        'parent',
        'parentJobId',
        'recordedActions',
        'startedAt',
      ].sort(),
    );
    expect(detail.createdBy).toEqual({ displayLabel: 'Submitter' });
    expect(JSON.stringify(detail)).not.toContain('@');
    for (const id of [WORKSPACE_ID, FORM_ID, SUBMITTER_ID, MEMBER_ID, ADMIN_ID]) {
      expect(JSON.stringify(detail)).not.toContain(id);
    }
  });

  it('names a member of the workspace, and says where anyone else stands without naming them', () => {
    const detail = toStaffJobDetail(loaded());
    expect(detail.lastRequeuedBy).toEqual({ standing: 'member', displayLabel: 'Form Admin' });
    expect(detail.cancelRequestedBy).toEqual({
      standing: 'platformAdministrator',
      displayLabel: null,
    });
  });

  // Someone who acted through a staff route was a member then; they are not a platform
  // administrator because they have left.
  it('calls someone who acted as a member and has since left a former member', () => {
    const detail = toStaffJobDetail(
      loaded({
        lastRequeuedBy: {
          id: MEMBER_ID,
          displayLabel: 'Form Admin',
          member: false,
          viaAdmin: false,
        },
      }),
    );
    expect(detail.lastRequeuedBy).toEqual({ standing: 'formerMember', displayLabel: null });
  });

  it('names a member who acted through the administration routes', () => {
    const detail = toStaffJobDetail(
      loaded({
        cancelRequestedBy: {
          id: ADMIN_ID,
          displayLabel: 'Platform Admin',
          member: true,
          viaAdmin: true,
        },
      }),
    );
    expect(detail.cancelRequestedBy).toEqual({
      standing: 'member',
      displayLabel: 'Platform Admin',
    });
  });

  it('keeps the links: its own, its parent and the live submission', () => {
    expect(toStaffJobDetail(loaded())).toMatchObject({
      id: JOB_ID,
      parentJobId: PARENT_ID,
      parent: { id: PARENT_ID },
      submissionId: SUBMISSION_ID,
    });
  });
});
