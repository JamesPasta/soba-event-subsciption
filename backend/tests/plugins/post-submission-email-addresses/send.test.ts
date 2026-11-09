import type { Logger } from 'pino';
import type { ClaimedJob } from '../../../src/core/db/repos/jobRepo';
import type { SendEmail } from '../../../src/core/integrations/notification/NotificationAdapter';
import type {
  PostSubmissionActionEmailResult,
  PostSubmissionActionNotifications,
  PostSubmissionActionSendScope,
} from '../../../src/core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import { JobCancelledError } from '../../../src/core/jobs/settlement';
import { sendNotices } from '../../../src/plugins/post-submission-email-addresses/send';

const LIMITS = { form: 500, workspace: 2000, environment: 5000 };
const ACCEPTED: PostSubmissionActionEmailResult = {
  outcome: 'accepted',
  httpStatus: null,
  audited: true,
};
const submission = {
  id: 's1',
  formId: 'f1',
  formName: 'Permit application',
  workspaceId: 'w1',
  workspaceName: 'Licensing',
  confirmationCode: 'ABCD1234',
};

/**
 * The notifications service the framework passes in, kept in memory: what it answers per address,
 * what this job already handled, whether its current run has handled any (by default, when any is
 * handled), and what each scope sent in the last hour.
 */
function fakeNotifications(
  setup: {
    enabled?: boolean;
    handled?: string[];
    runStarted?: boolean;
    sent?: Partial<Record<PostSubmissionActionSendScope, number>>;
    answers?: Record<string, PostSubmissionActionEmailResult>;
  } = {},
) {
  const emails: SendEmail[] = [];
  const counted: PostSubmissionActionSendScope[] = [];
  const notifications: PostSubmissionActionNotifications = {
    enabled: () => Promise.resolve(setup.enabled ?? true),
    sendEmail: (email) => {
      emails.push(email);
      return Promise.resolve(setup.answers?.[email.recipients.to[0]] ?? ACCEPTED);
    },
    handled: () =>
      Promise.resolve({
        recipients: new Set(setup.handled ?? []),
        runStarted: setup.runStarted ?? (setup.handled ?? []).length > 0,
      }),
    sentSince: (scope) => {
      counted.push(scope);
      return Promise.resolve(setup.sent?.[scope] ?? 0);
    },
  };
  const recipients = () => emails.map((email) => email.recipients.to[0]);
  return { notifications, emails, counted, recipients };
}

const run = (
  to: string[],
  notifications: PostSubmissionActionNotifications,
  options: { signal?: AbortSignal; info?: jest.Mock; warn?: jest.Mock } = {},
) =>
  sendNotices(
    {
      job: { id: 'job-1' } as ClaimedJob,
      options: { to },
      source: { scope: 'form', settingId: 'setting-1', version: 1 },
      submission,
      services: { notifications },
      signal: options.signal ?? new AbortController().signal,
      log: {
        info: options.info ?? jest.fn(),
        warn: options.warn ?? jest.fn(),
      } as unknown as Logger,
    },
    LIMITS,
    'https://soba.example/link',
  );

describe('sendNotices', () => {
  it('sends the notice to each address in turn, as plain text, and logs only counts', async () => {
    const fake = fakeNotifications();
    const info = jest.fn();
    await run(['a@example.com', 'b@example.com'], fake.notifications, { info });

    expect(fake.recipients()).toEqual(['a@example.com', 'b@example.com']);
    expect(fake.emails[0].content).toMatchObject({
      subject: 'Submission received: Permit application',
      bodyType: 'text',
    });
    expect(fake.emails[0].content.body).toContain('Confirmation ID: ABCD1234');
    expect(info).toHaveBeenCalledWith(
      { sent: 2, refused: 0, alreadyHandled: 0 },
      'Post-submission email sent',
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('@');
  });

  it('sends only to addresses this job has not handled, without checking the budgets again', async () => {
    const fake = fakeNotifications({ handled: ['a@example.com'], sent: { form: 500 } });
    await run(['a@example.com', 'b@example.com'], fake.notifications);

    expect(fake.recipients()).toEqual(['b@example.com']);
    expect(fake.counted).toEqual([]);
  });

  // A re-run whose first attempt failed before sending, on any attempt.
  it('checks the budgets for what is left until a re-run has handled an address', async () => {
    const fake = fakeNotifications({
      handled: ['a@example.com'],
      runStarted: false,
      sent: { form: 499 },
    });
    const outcome = run(['a@example.com', 'b@example.com', 'c@example.com'], fake.notifications);

    await expect(outcome).rejects.toThrow(
      new JobCancelledError('Hourly email limit for the form reached: 2 to send, limit 500'),
    );
    expect(fake.emails).toEqual([]);
  });

  it('does nothing when every address was handled', async () => {
    const fake = fakeNotifications({ handled: ['a@example.com'], enabled: false });
    await run(['a@example.com'], fake.notifications);
    expect(fake.emails).toEqual([]);
  });

  it('ends cancelled, sending nothing, when notifications are off', async () => {
    const fake = fakeNotifications({ enabled: false });
    await expect(run(['a@example.com'], fake.notifications)).rejects.toThrow(
      new JobCancelledError('Notifications are off'),
    );
    expect(fake.emails).toEqual([]);
  });

  it.each([
    ['form', { form: 499 }, 'Hourly email limit for the form reached: 2 to send, limit 500'],
    [
      'workspace',
      { workspace: 1999 },
      'Hourly email limit for the workspace reached: 2 to send, limit 2000',
    ],
    // Staff read the reason; how much email the whole environment sent is not theirs to see.
    [
      'environment',
      { environment: 4999 },
      'Hourly email limit for this environment reached; try again later',
    ],
  ])(
    'ends cancelled, sending nothing, when the %s limit would be passed',
    async (_scope, sent, reason) => {
      const fake = fakeNotifications({ sent });
      const outcome = run(['a@example.com', 'b@example.com'], fake.notifications);
      await expect(outcome).rejects.toBeInstanceOf(JobCancelledError);
      await expect(outcome).rejects.toThrow(reason);
      expect(fake.emails).toEqual([]);
    },
  );

  it('logs the numbers a limit stopped it on, without addresses', async () => {
    const fake = fakeNotifications({ sent: { environment: 4999 } });
    const warn = jest.fn();
    await expect(
      run(['a@example.com', 'b@example.com'], fake.notifications, { warn }),
    ).rejects.toBeInstanceOf(JobCancelledError);
    expect(warn).toHaveBeenCalledWith(
      { scope: 'environment', sent: 4999, limit: 5000, toSend: 2 },
      'Post-submission email over an hourly limit',
    );
  });

  it.each([400, 422])(
    'records an address refused with %i, carries on, and warns with counts',
    async (httpStatus) => {
      const fake = fakeNotifications({
        answers: { 'a@example.com': { outcome: 'error', httpStatus, audited: true } },
      });
      const warn = jest.fn();
      await run(['a@example.com', 'b@example.com'], fake.notifications, { warn });

      expect(fake.recipients()).toEqual(['a@example.com', 'b@example.com']);
      expect(warn).toHaveBeenCalledWith(
        { sent: 1, refused: 1, alreadyHandled: 0 },
        'Post-submission email sent; some addresses were refused',
      );
    },
  );

  it('ends cancelled when a fresh list is refused at every address', async () => {
    const refused = { outcome: 'error' as const, httpStatus: 400, audited: true };
    const fake = fakeNotifications({
      answers: { 'a@example.com': refused, 'b@example.com': refused },
    });
    const warn = jest.fn();
    const outcome = run(['a@example.com', 'b@example.com'], fake.notifications, { warn });

    await expect(outcome).rejects.toThrow(
      new JobCancelledError('The provider refused every address (2)'),
    );
    expect(warn).toHaveBeenCalledWith(
      { sent: 0, refused: 2, alreadyHandled: 0 },
      'Post-submission email refused for every address',
    );
  });

  it('finishes a retry whose remaining addresses are all refused', async () => {
    const fake = fakeNotifications({
      handled: ['a@example.com'],
      answers: { 'b@example.com': { outcome: 'error', httpStatus: 400, audited: true } },
    });
    await expect(run(['a@example.com', 'b@example.com'], fake.notifications)).resolves.toBe(
      undefined,
    );
  });

  it.each([401, 403, 429, 503, null])(
    'stops at an error with status %s and throws without naming addresses, so the job retries',
    async (httpStatus) => {
      const fake = fakeNotifications({
        answers: { 'b@example.com': { outcome: 'error', httpStatus, audited: true } },
      });
      const outcome = run(['a@example.com', 'b@example.com', 'c@example.com'], fake.notifications);

      await expect(outcome).rejects.toThrow(
        `Email send failed (status ${httpStatus ?? 'none'}) after 1 of 3`,
      );
      await expect(outcome).rejects.not.toBeInstanceOf(JobCancelledError);
      expect(fake.recipients()).toEqual(['a@example.com', 'b@example.com']);
    },
  );

  it('stops and throws when a send was not recorded, so it is not sent again unrecorded', async () => {
    const fake = fakeNotifications({
      answers: { 'a@example.com': { ...ACCEPTED, audited: false } },
    });
    await expect(run(['a@example.com', 'b@example.com'], fake.notifications)).rejects.toThrow(
      'A send was not recorded; stopping after 0 of 2',
    );
    expect(fake.recipients()).toEqual(['a@example.com']);
  });

  it('ends cancelled when notifications turn off part way through', async () => {
    const fake = fakeNotifications({
      answers: { 'b@example.com': { outcome: 'disabled', httpStatus: null, audited: true } },
    });
    await expect(
      run(['a@example.com', 'b@example.com', 'c@example.com'], fake.notifications),
    ).rejects.toThrow(new JobCancelledError('Notifications are off'));
    expect(fake.recipients()).toEqual(['a@example.com', 'b@example.com']);
  });

  it("throws the runner's abort reason before the next send", async () => {
    const controller = new AbortController();
    const fake = fakeNotifications();
    const sendEmail = fake.notifications.sendEmail;
    fake.notifications.sendEmail = async (email) => {
      const result = await sendEmail(email);
      // The runner aborts with its stop reason as a string.
      controller.abort('lease_lost');
      return result;
    };

    await expect(
      run(['a@example.com', 'b@example.com'], fake.notifications, { signal: controller.signal }),
    ).rejects.toBe('lease_lost');
    expect(fake.recipients()).toEqual(['a@example.com']);
  });
});
