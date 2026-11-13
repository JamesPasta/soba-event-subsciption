import type { EventSubscriptionSettings } from '@soba/lib';
import {
  eventSubscriptionService,
  revealEventSubscriptionToken,
} from '../../../src/features/form-settings/event-subscription/service';
import {
  findEncryptedEventSubscriptionToken,
  findEventSubscription,
  updateEventSubscription,
} from '../../../src/features/form-settings/event-subscription/repo';
import { encryptSubscriptionToken } from '../../../src/features/form-settings/event-subscription/token';
import { SETTINGS_CHANGED } from '../../../src/features/form-settings/saved';

jest.mock('../../../src/features/form-settings/event-subscription/repo', () => ({
  findEventSubscription: jest.fn(),
  findEncryptedEventSubscriptionToken: jest.fn(),
  updateEventSubscription: jest.fn(),
}));

const find = jest.mocked(findEventSubscription);
const findToken = jest.mocked(findEncryptedEventSubscriptionToken);
const update = jest.mocked(updateEventSubscription);
const context = { workspaceId: 'ws1', actorId: 'a1', actorDisplayLabel: 'Tester' };
const settings: EventSubscriptionSettings = {
  endpointUrl: 'https://example.test/events',
  key: 'example',
  hasToken: true,
  version: 2,
  updatedAt: '2025-07-18T00:00:00.000Z',
  updatedBy: 'Tester',
};
const originalKey = process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY;

afterAll(() => {
  if (originalKey === undefined) delete process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY;
  else process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = originalKey;
});

beforeEach(() => {
  jest.resetAllMocks();
  process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = 'ab'.repeat(32);
  find.mockResolvedValue(settings);
  update.mockResolvedValue('saved');
});

describe('eventSubscriptionService', () => {
  it('reads only metadata and saves an encrypted replacement token', async () => {
    const saved = await eventSubscriptionService.set(context, 'f1', {
      endpointUrl: settings.endpointUrl,
      key: settings.key,
      version: settings.version,
      token: 'new secret',
    });
    expect(saved).toEqual(settings);
    expect(saved).not.toHaveProperty('token');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        formId: 'f1',
        version: 2,
        encryptedToken: expect.stringMatching(/^v1:/),
      }),
    );
    expect(update.mock.calls[0]?.[0].encryptedToken).not.toContain('new secret');
  });

  it('leaves the token unchanged when only URL or key changes', async () => {
    await eventSubscriptionService.set(context, 'f1', {
      endpointUrl: 'https://example.test/new',
      key: settings.key,
      version: 2,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedToken: undefined,
        endpointUrl: 'https://example.test/new',
      }),
    );
  });

  it('decrypts a saved token only when explicitly requested', async () => {
    findToken.mockResolvedValue(encryptSubscriptionToken('saved-secret'));
    expect(await revealEventSubscriptionToken(context, 'f1')).toEqual({ token: 'saved-secret' });
    expect(findToken).toHaveBeenCalledWith('ws1', 'f1');
    expect(find).not.toHaveBeenCalled();
  });

  it('reports a missing saved token rather than returning an empty secret', async () => {
    findToken.mockResolvedValue(null);
    await expect(revealEventSubscriptionToken(context, 'f1')).rejects.toThrow(
      'Endpoint token not found',
    );
  });

  it('reports version conflicts rather than replacing another edit', async () => {
    update.mockResolvedValue('conflict');
    await expect(
      eventSubscriptionService.set(context, 'f1', {
        endpointUrl: settings.endpointUrl,
        key: settings.key,
        version: 2,
      }),
    ).rejects.toThrow(SETTINGS_CHANGED);
  });
});
