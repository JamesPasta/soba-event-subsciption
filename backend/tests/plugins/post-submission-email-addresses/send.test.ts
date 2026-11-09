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
 * The notifications service the framework passes in, kept in memory: what this job already
 * handled, whether its current run has handled any (by default, when any is handled), and what each
 * scope sent in the last hour. Every send is accepted.
 */
function fakeNotifications(
  setup: {
    handled?: string[];
    runStarted?: boolean;
    sent?: Partial<Record<PostSubmissionActionSendScope, number>>;
  } = {},
) {
  const emails: SendEmail[] = [];
  const counted: PostSubmissionActionSendScope[] = [];
  const notifications: PostSubmissionActionNotifications = {
    enabled: () => Promise.resolve(true),
    sendEmail: (email) => {
      emails.push(email);
      return Promise.resolve(ACCEPTED);
    },
    handled: () =>
      Promise.resolve({
        recipients: new Set(setup.handled ?? []),
        runStarted: setup.runStarted ?? (setup.handled ?? []).length > 0,
        anySent: (setup.handled ?? []).length > 0,
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
  options: { warn?: jest.Mock } = {},
) =>
  sendNotices(
    {
      job: { id: 'job-1' } as ClaimedJob,
      options: { to },
      source: { scope: 'form', settingId: 'setting-1', version: 1 },
      submission,
      services: { notifications },
      signal: new AbortController().signal,
      log: { info: jest.fn(), warn: options.warn ?? jest.fn() } as unknown as Logger,
    },
    LIMITS,
    'https://soba.example/designer',
  );

describe('sendNotices', () => {
  it('sends the notice to each address, as HTML, with a link to the submission', async () => {
    const fake = fakeNotifications();
    await run(['a@example.com', 'b@example.com'], fake.notifications);

    expect(fake.recipients()).toEqual(['a@example.com', 'b@example.com']);
    expect(fake.emails[0].content).toMatchObject({
      subject: 'Permit application Submission / Soumission : Permit application (ABCD1234)',
      bodyType: 'html',
    });
    expect(fake.emails[0].content.body).toContain(
      'href="https://soba.example/designer/en/build/f1/submissions/s1"',
    );
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
});
