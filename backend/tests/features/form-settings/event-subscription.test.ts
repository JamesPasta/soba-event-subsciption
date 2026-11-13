import { SetEventSubscriptionSettingsBodySchema } from '@soba/lib';
import {
  decryptSubscriptionToken,
  encryptSubscriptionToken,
} from '../../../src/features/form-settings/event-subscription/token';

const KEY = 'ab'.repeat(32);
const originalKey = process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY;

afterAll(() => {
  if (originalKey === undefined) delete process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY;
  else process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = originalKey;
});

beforeEach(() => {
  process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = KEY;
});

describe('event subscription token storage', () => {
  it('encrypts tokens with a fresh nonce and authenticates them on decrypt', () => {
    const first = encryptSubscriptionToken('sensitive token');
    const second = encryptSubscriptionToken('sensitive token');
    expect(first).not.toContain('sensitive token');
    expect(first).not.toBe(second);
    expect(decryptSubscriptionToken(first)).toBe('sensitive token');
    expect(decryptSubscriptionToken(second)).toBe('sensitive token');
    expect(() => decryptSubscriptionToken(`${first.slice(0, -2)}zz`)).toThrow();
  });

  it('requires a valid key before saving or reading tokens', () => {
    delete process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY;
    expect(() => encryptSubscriptionToken('token')).toThrow(
      'Endpoint token storage is not configured',
    );
    process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = KEY;
    const encrypted = encryptSubscriptionToken('token');
    process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = 'short';
    expect(() => decryptSubscriptionToken(encrypted)).toThrow(
      'Endpoint token storage is not configured',
    );
  });

  it('accepts only HTTP endpoints and explicit versioned saves', () => {
    const body = { endpointUrl: 'https://endpoint.gov.bc.ca/api/v1/', key: 'example', version: 1 };
    expect(SetEventSubscriptionSettingsBodySchema.safeParse(body).success).toBe(true);
    expect(SetEventSubscriptionSettingsBodySchema.safeParse({ ...body, token: null }).success).toBe(
      false,
    );
    expect(
      SetEventSubscriptionSettingsBodySchema.safeParse({ ...body, endpointUrl: 'file:///secret' })
        .success,
    ).toBe(false);
    expect(
      SetEventSubscriptionSettingsBodySchema.safeParse({
        ...body,
        endpointUrl: 'https://user:password@example.test/events',
      }).success,
    ).toBe(false);
    expect(
      SetEventSubscriptionSettingsBodySchema.safeParse({ ...body, version: undefined }).success,
    ).toBe(false);
  });
});
