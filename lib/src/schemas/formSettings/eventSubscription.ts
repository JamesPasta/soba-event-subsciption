import { z } from 'zod';

export const EVENT_SUBSCRIPTION_SETTINGS_KEY = 'event-subscription';

const endpointUrl = z
  .string()
  .max(2048)
  .refine(
    (value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
      } catch {
        return false;
      }
    },
    { message: 'Enter an HTTP or HTTPS endpoint URL' },
  );

export const EventSubscriptionSettingsSchema = z.object({
  endpointUrl,
  key: z.string().max(255),
  hasToken: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
});
export type EventSubscriptionSettings = z.infer<typeof EventSubscriptionSettingsSchema>;

export const SetEventSubscriptionSettingsBodySchema = z.object({
  endpointUrl,
  key: z.string().max(255),
  version: z.number().int().positive(),
  /** Omitted keeps the saved token; GET never returns its value. */
  token: z.string().min(1).max(4096).optional(),
});
export type SetEventSubscriptionSettingsBody = z.infer<
  typeof SetEventSubscriptionSettingsBodySchema
>;
