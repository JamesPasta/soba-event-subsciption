# Notify v1

Discovered by the plugin registry as `notify-v1`. The notification adapter is
created lazily, so an unconfigured Notify service does not prevent SOBA startup.
`notification-noop` is the default; select this plugin with
`NOTIFICATION_DEFAULT_CODE=notify-v1`.

Configure these backend environment variables (put the API key in a Secret):

- `NOTIFICATION_DEFAULT_CODE=notify-v1`
- `PLUGIN_NOTIFY_V1_ENDPOINT`: Notify base URL including `/api/v1`
- `PLUGIN_NOTIFY_V1_API_KEY`: the SOBA API key
- `PLUGIN_NOTIFY_V1_TIMEOUT_MS`: optional outbound timeout
- `PLUGIN_NOTIFY_V1_DEBUG_RESPONSES=true`: log full upstream HTTP error response bodies
  and unexpected success responses with schema validation issues
  for local debugging. Disabled by default; bodies may contain private data.

Notify test only delivers to addresses on its safelist. Add each recipient at
https://common-notify-test.apps.silver.devops.gov.bc.ca/settings

The adapter authenticates to Notify using only the configured `X-API-KEY`. At
startup the backend logs whether a keyed `GET code-tables/channels` returns
Notify's channel list, which checks the endpoint and the key without sending.

Backend code sends email through the notification service, which checks the
`notifications` feature, calls the active plugin and writes one
`notification_audit` row per send:

```ts
import { notificationService } from '../../features/notifications/service';

const { outcome } = await notificationService.sendEmail(
  { workspaceId, formId, submissionId, actorId },
  {
    recipients: { to: ['recipient@example.com'] },
    content: { subject: 'SOBA notification', body: 'Hello from SOBA', bodyType: 'text' },
  },
);
```

The request is checked against `SendEmailSchema`. Optional `cc` and `bcc` arrays
are supported. `bodyType` is `text` or `html`. The receipt's `id` is Notify's
`notifyId` and `status` is Notify's status; acceptance does not mean delivery.
Sends are never retried automatically. Upstream failures throw
`ServiceUnavailableError` with the upstream status; its message carries no
recipient or credential details. Notify's error text, such as a safelist
refusal, goes to the audit row only.
