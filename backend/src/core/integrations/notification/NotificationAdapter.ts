import { z } from 'zod';
import { EmailAddressSchema } from '@soba/lib';
import type { PluginConfigReader } from '../../config/pluginConfig';

const addresses = z.array(EmailAddressSchema).max(100);

export const SendEmailSchema = z.strictObject({
  recipients: z.strictObject({
    to: addresses.min(1),
    cc: addresses.optional(),
    bcc: addresses.optional(),
  }),
  content: z.strictObject({
    subject: z.string().trim().min(1).max(998),
    body: z.string().min(1).max(100_000),
    bodyType: z.enum(['text', 'html']).default('text'),
  }),
});
export type SendEmail = z.infer<typeof SendEmailSchema>;

/** What the provider answered for an accepted email. Accepted is not delivered. */
export interface EmailReceipt {
  /** The provider's id for the message; null when nothing was sent. */
  id: string | null;
  status: string;
}

/**
 * Attaches the provider's error text to a send error. It is not enumerable, so logging the error
 * leaves it out; the text can name recipients.
 */
export const withProviderDetail = <E extends Error>(error: E, detail: string | undefined): E => {
  if (detail) Object.defineProperty(error, 'providerDetail', { value: detail, enumerable: false });
  return error;
};

/** The provider's error text on a failed send, for the audit; undefined when there is none. */
export const providerDetailOf = (err: unknown): string | undefined => {
  const detail = (err as { providerDetail?: unknown } | null)?.providerDetail;
  return typeof detail === 'string' ? detail : undefined;
};

/** Result of a notification readiness check; no config or credentials are exposed. */
export interface NotificationReadinessResult {
  ok: boolean;
  message?: string;
}

export interface NotificationAdapter {
  /** Optional: report whether the provider is reachable and accepts the configured credentials. */
  readinessCheck?(): Promise<NotificationReadinessResult>;
  sendEmail(email: SendEmail): Promise<EmailReceipt>;
}

export interface NotificationPluginDefinition {
  code: string;
  metadata: { code: string; name: string; version?: string };
  createAdapter: (config: PluginConfigReader) => NotificationAdapter;
}
