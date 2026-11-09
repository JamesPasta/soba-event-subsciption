import { createNotificationService } from '../../../src/features/notifications/service';
import { NotifyV1Adapter } from '../../../src/plugins/notify-v1/notifyV1Adapter';
import { notificationPluginDefinition as noopDefinition } from '../../../src/plugins/notification-noop';
import { createPluginConfigReaderFrom } from '../../../src/core/config/pluginConfig';
import { createEnvReader } from '../../../src/core/config/env';
import {
  SendEmailSchema,
  type NotificationAdapter,
} from '../../../src/core/integrations/notification/NotificationAdapter';
import type { NewNotificationAudit } from '../../../src/core/db/repos/notificationAuditRepo';
import { log } from '../../../src/core/logging';

jest.mock('../../../src/core/db/client', () => ({ db: {} }));

const config = createPluginConfigReaderFrom(
  createEnvReader({
    PLUGIN_NOTIFY_V1_ENDPOINT: 'https://notify.example/api/v1',
    PLUGIN_NOTIFY_V1_API_KEY: 'configured-key',
  }),
  'notify-v1',
);
const context = { workspaceId: 'w1', formId: 'f1', submissionId: 's1', actorId: 'u1' };
const email = SendEmailSchema.parse({
  recipients: { to: ['staff@example.com'], bcc: ['records@example.com'] },
  content: { subject: 'New form submission', body: 'A new submission has been received.' },
});

/** The service over a real adapter, with audit rows kept in memory instead of the table. */
function serviceWith(adapter: NotificationAdapter, enabled = true) {
  const audits: NewNotificationAudit[] = [];
  const service = createNotificationService({
    isEnabled: () => Promise.resolve(enabled),
    adapter: () => adapter,
    pluginCode: () => 'notify-v1',
    writeAudit: (row) => {
      audits.push(row);
      return Promise.resolve();
    },
  });
  return { service, audits };
}

afterEach(() => jest.restoreAllMocks());

describe('notification service', () => {
  it('sends nothing and records it when the feature is off', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const { service, audits } = serviceWith(new NotifyV1Adapter(config), false);

    await expect(service.sendEmail(context, email)).resolves.toEqual({
      outcome: 'disabled',
      providerMessageId: null,
      httpStatus: null,
      audited: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audits).toEqual([
      expect.objectContaining({
        workspaceId: 'w1',
        formId: 'f1',
        submissionId: 's1',
        pluginCode: 'notify-v1',
        channel: 'email',
        outcome: 'disabled',
        recipients: { to: ['staff@example.com'], bcc: ['records@example.com'] },
        subject: 'New form submission',
        createdBy: 'u1',
      }),
    ]);
  });

  it("records an accepted send with Notify's id and status", async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ notifyId: 'n-1', status: 'queued' }), { status: 202 }),
      );
    const { service, audits } = serviceWith(new NotifyV1Adapter(config));

    await expect(service.sendEmail({ ...context, jobId: 'j1' }, email)).resolves.toEqual({
      outcome: 'accepted',
      providerMessageId: 'n-1',
      httpStatus: null,
      audited: true,
    });
    expect(audits[0]).toMatchObject({
      jobId: 'j1',
      outcome: 'accepted',
      providerMessageId: 'n-1',
      providerStatus: 'queued',
    });
    expect(audits[0].errorDetail).toBeUndefined();
  });

  it("records a refused send with the upstream status and Notify's reason", async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Request validation failed',
          errors: ["Recipient(s) not on this tenant's safelist: staff@example.com."],
        }),
        { status: 400 },
      ),
    );
    const { service, audits } = serviceWith(new NotifyV1Adapter(config));

    await expect(service.sendEmail(context, email)).resolves.toEqual({
      outcome: 'error',
      providerMessageId: null,
      httpStatus: 400,
      audited: true,
    });
    expect(audits[0]).toMatchObject({
      outcome: 'error',
      httpStatus: 400,
      errorDetail:
        "ServiceUnavailableError upstream 400: Request validation failed: Recipient(s) not on this tenant's safelist: staff@example.com.",
    });
  });

  it('bounds the error detail', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('x'.repeat(2000), { status: 502 }));
    const { service, audits } = serviceWith(new NotifyV1Adapter(config));

    await service.sendEmail(context, email);
    expect(audits[0].errorDetail).toHaveLength(500);
  });

  it('records a send the noop plugin skipped', async () => {
    const { service, audits } = serviceWith(noopDefinition.createAdapter(config));

    await expect(service.sendEmail(context, email)).resolves.toEqual({
      outcome: 'not_sent',
      providerMessageId: null,
      httpStatus: null,
      audited: true,
    });
    expect(audits[0]).toMatchObject({ outcome: 'not_sent', providerStatus: 'not_sent' });
  });

  it('still answers when the audit write fails, and says the row is missing', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ notifyId: 'n-2', status: 'queued' }), { status: 202 }),
      );
    const service = createNotificationService({
      isEnabled: () => Promise.resolve(true),
      adapter: () => new NotifyV1Adapter(config),
      pluginCode: () => 'notify-v1',
      writeAudit: () => Promise.reject(new Error('database unavailable')),
    });

    await expect(service.sendEmail(context, email)).resolves.toEqual({
      outcome: 'accepted',
      providerMessageId: 'n-2',
      httpStatus: null,
      audited: false,
    });
  });

  it('logs a failed audit write without the values it tried to insert', async () => {
    const errorLog = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    const service = createNotificationService({
      isEnabled: () => Promise.resolve(true),
      adapter: () => noopDefinition.createAdapter(config),
      pluginCode: () => 'notification-noop',
      writeAudit: () =>
        Promise.reject(
          new Error('Failed query: insert ... params: staff@example.com,New form submission'),
        ),
    });

    await service.sendEmail(context, email);

    expect(errorLog).toHaveBeenCalledWith(
      {
        pluginCode: 'notification-noop',
        workspaceId: 'w1',
        submissionId: 's1',
        errorName: 'Error',
      },
      'Failed to write notification audit',
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('staff@example.com');
  });
});
