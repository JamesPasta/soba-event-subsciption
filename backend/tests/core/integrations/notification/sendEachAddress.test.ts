import type { Logger } from 'pino';
import type { SendEmail } from '../../../../src/core/integrations/notification/NotificationAdapter';
import type {
  JobEmailResult,
  JobNotifications,
} from '../../../../src/core/integrations/notification/JobNotifications';
import {
  sendEachAddress,
  type SendPolicy,
} from '../../../../src/core/integrations/notification/sendEachAddress';
import { JobCancelledError } from '../../../../src/core/jobs/settlement';

const ACCEPTED: JobEmailResult = { outcome: 'accepted', httpStatus: null, audited: true };
const CONTENT: SendEmail['content'] = { subject: 'Subject', body: '<p>Body</p>', bodyType: 'html' };

/**
 * The job's notifications, kept in memory: what the provider answers per address, the addresses
 * this job sent to or had refused on earlier attempts, and whether its current run has handled any
 * (by default, when any is handled).
 */
function fakeNotifications(
  setup: {
    enabled?: boolean;
    handled?: string[];
    refusedBefore?: string[];
    runStarted?: boolean;
    answers?: Record<string, JobEmailResult>;
  } = {},
) {
  const emails: SendEmail[] = [];
  const sentBefore = setup.handled ?? [];
  const handled = [...sentBefore, ...(setup.refusedBefore ?? [])];
  const notifications: JobNotifications = {
    enabled: jest.fn(() => Promise.resolve(setup.enabled ?? true)),
    sendEmail: (email) => {
      emails.push(email);
      return Promise.resolve(setup.answers?.[email.recipients.to[0]] ?? ACCEPTED);
    },
    handled: () =>
      Promise.resolve({
        recipients: new Set(handled),
        runStarted: setup.runStarted ?? handled.length > 0,
        anySent: sentBefore.length > 0,
      }),
    sentSince: () => Promise.resolve(0),
  };
  const recipients = () => emails.map((email) => email.recipients.to[0]);
  return { notifications, emails, recipients };
}

const run = (
  to: string[],
  notifications: JobNotifications,
  options: { signal?: AbortSignal; info?: jest.Mock; warn?: jest.Mock; policy?: SendPolicy } = {},
) =>
  sendEachAddress(
    {
      notifications,
      signal: options.signal ?? new AbortController().signal,
      log: {
        info: options.info ?? jest.fn(),
        warn: options.warn ?? jest.fn(),
      } as unknown as Logger,
    },
    to,
    CONTENT,
    options.policy,
  );

describe('sendEachAddress', () => {
  it('sends the content to each address in turn and logs only counts', async () => {
    const fake = fakeNotifications();
    const info = jest.fn();
    await run(['a@example.com', 'b@example.com'], fake.notifications, { info });

    expect(fake.recipients()).toEqual(['a@example.com', 'b@example.com']);
    expect(fake.emails[0].content).toEqual(CONTENT);
    expect(info).toHaveBeenCalledWith({ sent: 2, refused: 0, alreadyHandled: 0 }, 'Emails sent');
    expect(JSON.stringify(info.mock.calls)).not.toContain('@');
  });

  it('sends to each address once, in lower case', async () => {
    const fake = fakeNotifications();
    await run([' A@Example.com', 'a@example.com', 'B@example.com '], fake.notifications);
    expect(fake.recipients()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('skips an address handled before whatever its case', async () => {
    const fake = fakeNotifications({ handled: ['A@Example.com'] });
    await run(['a@example.com', 'b@example.com'], fake.notifications);
    expect(fake.recipients()).toEqual(['b@example.com']);
  });

  it('counts an address no provider would take as refused, without sending to it', async () => {
    const fake = fakeNotifications();
    const warn = jest.fn();
    await run(['not an address', 'a@example.com'], fake.notifications, { warn });

    expect(fake.recipients()).toEqual(['a@example.com']);
    expect(warn).toHaveBeenCalledWith(
      { sent: 1, refused: 1, alreadyHandled: 0 },
      'Emails sent; some addresses were refused',
    );
  });

  it('ends cancelled, sending nothing, when no address is usable', async () => {
    const fake = fakeNotifications();
    await expect(run(['not an address'], fake.notifications)).rejects.toThrow(
      new JobCancelledError('Every address was refused (1)'),
    );
    expect(fake.emails).toEqual([]);
  });

  it('checks the budgets for what is left until the run has handled an address', async () => {
    const checkBudgets = jest.fn(() => Promise.resolve());
    await run(['a@example.com', 'b@example.com'], fakeNotifications().notifications, {
      policy: { checkBudgets },
    });
    expect(checkBudgets).toHaveBeenCalledWith(2);

    checkBudgets.mockClear();
    const started = fakeNotifications({ handled: ['a@example.com'] });
    await run(['a@example.com', 'b@example.com'], started.notifications, {
      policy: { checkBudgets },
    });
    expect(checkBudgets).not.toHaveBeenCalled();
    expect(started.recipients()).toEqual(['b@example.com']);
  });

  it('sends nothing when a budget check stops it', async () => {
    const fake = fakeNotifications();
    const stop = new JobCancelledError('Over the limit');
    await expect(
      run(['a@example.com'], fake.notifications, {
        policy: { checkBudgets: () => Promise.reject(stop) },
      }),
    ).rejects.toBe(stop);
    expect(fake.emails).toEqual([]);
  });

  it('does nothing when every address was handled, even with notifications off', async () => {
    const fake = fakeNotifications({ handled: ['a@example.com'], enabled: false });
    await run(['a@example.com'], fake.notifications);
    expect(fake.emails).toEqual([]);
    expect(fake.notifications.enabled).not.toHaveBeenCalled();
  });

  it('ends cancelled, sending nothing, when notifications are off', async () => {
    const fake = fakeNotifications({ enabled: false });
    await expect(run(['a@example.com'], fake.notifications)).rejects.toThrow(
      new JobCancelledError('Notifications are off'),
    );
    expect(fake.emails).toEqual([]);
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
        'Emails sent; some addresses were refused',
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

    await expect(outcome).rejects.toThrow(new JobCancelledError('Every address was refused (2)'));
    expect(warn).toHaveBeenCalledWith(
      { sent: 0, refused: 2, alreadyHandled: 0 },
      'Every address was refused',
    );
  });

  it('finishes a retry whose remaining addresses are all refused, once one was sent', async () => {
    const fake = fakeNotifications({
      handled: ['a@example.com'],
      answers: { 'b@example.com': { outcome: 'error', httpStatus: 400, audited: true } },
    });
    await expect(run(['a@example.com', 'b@example.com'], fake.notifications)).resolves.toBe(
      undefined,
    );
  });

  // a was refused, then b failed and the job retried; b is refused now.
  it('ends cancelled when every address was refused, across a retry', async () => {
    const fake = fakeNotifications({
      refusedBefore: ['a@example.com'],
      answers: { 'b@example.com': { outcome: 'error', httpStatus: 400, audited: true } },
    });
    await expect(run(['a@example.com', 'b@example.com'], fake.notifications)).rejects.toThrow(
      new JobCancelledError('Every address was refused (2)'),
    );
    expect(fake.recipients()).toEqual(['b@example.com']);
  });

  it('ends cancelled on a retry with nothing left to send, when every address was refused', async () => {
    const fake = fakeNotifications({ refusedBefore: ['a@example.com'] });
    await expect(run(['a@example.com'], fake.notifications)).rejects.toThrow(
      new JobCancelledError('Every address was refused (1)'),
    );
    expect(fake.emails).toEqual([]);
  });

  it('does nothing for an empty list', async () => {
    const fake = fakeNotifications();
    await expect(run([], fake.notifications)).resolves.toBe(undefined);
    expect(fake.notifications.enabled).not.toHaveBeenCalled();
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
