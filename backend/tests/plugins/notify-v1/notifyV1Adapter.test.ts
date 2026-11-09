import { HttpClientTimeoutError } from '../../../src/core/http/httpClient';
import { NotifyV1Adapter } from '../../../src/plugins/notify-v1/notifyV1Adapter';
import { createPluginConfigReaderFrom } from '../../../src/core/config/pluginConfig';
import { createEnvReader } from '../../../src/core/config/env';
import {
  SendEmailSchema,
  providerDetailOf,
  type SendEmail,
} from '../../../src/core/integrations/notification/NotificationAdapter';
import { upstreamStatusOf } from '../../../src/core/http/httpErrorMapper';

const email = SendEmailSchema.parse({
  recipients: { to: ['recipient@example.com'] },
  content: { subject: 'Hello', body: 'SOBA message' },
});
// Notify's 202 acceptance body.
const accepted = {
  notifyId: 'b4fe3ccc-b989-4a36-82f5-b512f5eb156a',
  status: 'queued',
  channels: ['email'],
  createdAt: '2026-10-05T12:00:00.000Z',
  message: 'Notification accepted for delivery',
};
const makeAdapter = () =>
  new NotifyV1Adapter(
    createPluginConfigReaderFrom(
      createEnvReader({
        PLUGIN_NOTIFY_V1_ENDPOINT: 'https://notify.example/api/v1',
        PLUGIN_NOTIFY_V1_API_KEY: 'configured-key',
      }),
      'notify-v1',
    ),
  );

afterEach(() => jest.restoreAllMocks());

// Notify test's answer for a recipient missing from the tenant safelist.
const safelistRefusal = {
  message: 'Request validation failed',
  errors: [
    "Recipient(s) not on this tenant's safelist: recipient@example.com. This environment only sends to safelisted recipients.",
  ],
};

test('keeps Notify error text out of the message but on the error for the audit', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(safelistRefusal), { status: 400 }));
  const err: unknown = await makeAdapter()
    .sendEmail(email)
    .catch((e: unknown) => e);
  expect(err).toEqual(new Error('Notify email send failed (upstream HTTP 400)'));
  expect(upstreamStatusOf(err)).toBe(400);
  expect(providerDetailOf(err)).toBe(
    "Request validation failed: Recipient(s) not on this tenant's safelist: recipient@example.com. This environment only sends to safelisted recipients.",
  );
  expect(Object.keys(err as object)).not.toContain('providerDetail');
});

test('keeps a non-JSON error body as the provider detail', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response('gateway exploded', { status: 502 }));
  const err: unknown = await makeAdapter()
    .sendEmail(email)
    .catch((e: unknown) => e);
  expect(providerDetailOf(err)).toBe('gateway exploded');
});

test('sends inline email with only the configured API key', async () => {
  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(accepted), { status: 202 }));
  await expect(makeAdapter().sendEmail(email)).resolves.toEqual({
    id: accepted.notifyId,
    status: 'queued',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://notify.example/api/v1/notifysimple/email',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(email),
      headers: expect.objectContaining({
        'X-API-KEY': 'configured-key',
      }),
    }),
  );
  expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
});

test('does not retry an ambiguous failure or expose upstream content', async () => {
  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response('secret upstream body', { status: 500 }));
  await expect(makeAdapter().sendEmail(email)).rejects.toThrow(
    'Notify email send failed (upstream HTTP 500)',
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('rejects malformed upstream success', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));
  await expect(makeAdapter().sendEmail(email)).rejects.toThrow('unexpected response');
});

test.each([
  ['an invalid recipient', { ...email, recipients: { to: ['not-an-address'] } }],
  ['a caller supplied tenant override', { ...email, cstarTenantId: 'other' }],
])('rejects %s without calling Notify or echoing it', async (_case, request) => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const sent = makeAdapter().sendEmail(request as SendEmail);
  await expect(sent).rejects.toThrow(new Error('Notify email request is not valid'));
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([401, 403, 404, 429, 502])(
  'reports upstream HTTP %s without exposing the response',
  async (status) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('configured-key recipient@example.com', { status }));
    await expect(makeAdapter().sendEmail(email)).rejects.toThrow(
      new Error(`Notify email send failed (upstream HTTP ${status})`),
    );
  },
);

test('reports a network cause without exposing its message', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(
    new TypeError('configured-key', {
      cause: Object.assign(new Error('recipient@example.com'), { code: 'ENOTFOUND' }),
    }),
  );
  await expect(makeAdapter().sendEmail(email)).rejects.toThrow(
    new Error('Notify email send failed (network ENOTFOUND)'),
  );
});

test('reports timeouts without exposing the request URL', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new HttpClientTimeoutError('https://private.example', 100, 30000));
  await expect(makeAdapter().sendEmail(email)).rejects.toThrow(
    new Error('Notify email send failed (timeout; budget 30000ms)'),
  );
});

test('identifies invalid JSON without exposing response content', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response('configured-key'));
  await expect(makeAdapter().sendEmail(email)).rejects.toThrow(
    new Error('Notify returned an invalid JSON response'),
  );
});

describe('readiness', () => {
  // Notify's channel code table, as GET code-tables/channels returns it.
  const channels = [
    { code: 'email', displayName: 'Email', description: 'Email', createdAt: '', updatedAt: '' },
  ];

  test('reads the channel list with the API key', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(channels)));
    await expect(makeAdapter().readinessCheck()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://notify.example/api/v1/code-tables/channels',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-API-KEY': 'configured-key' }),
      }),
    );
  });

  test('reports a rejected key without the response body', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{"message":"Unauthorized"}', { status: 401 }));
    await expect(makeAdapter().readinessCheck()).resolves.toEqual({
      ok: false,
      message: 'Notify readiness check failed (upstream HTTP 401)',
    });
  });

  test.each([
    ['an HTML page', '<!doctype html><html></html>', 'Notify returned an invalid JSON response'],
    ['other JSON', '{"status":"ok"}', 'Notify readiness check got an unexpected response'],
  ])('treats %s as a wrong endpoint', async (_case, body, message) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body));
    await expect(makeAdapter().readinessCheck()).resolves.toEqual({ ok: false, message });
  });

  test('reports a network cause without its message', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo notify.example'), { code: 'ENOTFOUND' }),
      }),
    );
    await expect(makeAdapter().readinessCheck()).resolves.toEqual({
      ok: false,
      message: 'Notify readiness check failed (network ENOTFOUND)',
    });
  });
});
