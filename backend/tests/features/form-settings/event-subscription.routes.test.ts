import express from 'express';
import request from 'supertest';

jest.mock('../../../src/core/middleware/requireFormPermissions', () => {
  const { ForbiddenError } = jest.requireActual('../../../src/core/errors');
  return {
    requireFormPermissions:
      () => (req: express.Request, _res: express.Response, next: express.NextFunction) =>
        next(req.get('x-deny') ? new ForbiddenError('Insufficient form permissions') : undefined),
  };
});

jest.mock('../../../src/features/form-settings/event-subscription/repo', () => ({
  findEventSubscription: jest.fn(),
  findEncryptedEventSubscriptionToken: jest.fn(),
  updateEventSubscription: jest.fn(),
}));

import {
  findEncryptedEventSubscriptionToken,
  findEventSubscription,
} from '../../../src/features/form-settings/event-subscription/repo';
import { encryptSubscriptionToken } from '../../../src/features/form-settings/event-subscription/token';
import { eventSubscriptionSettingsModule } from '../../../src/features/form-settings/event-subscription';
import { coreErrorHandler } from '../../../src/core/middleware/errorHandler';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.coreContext = {
    workspaceId: 'ws1',
    actorId: 'a1',
    actorDisplayLabel: 'Tester',
  } as NonNullable<typeof req.coreContext>;
  next();
});
app.use('/forms/:id/settings/event-subscription', eventSubscriptionSettingsModule.router());
app.use(coreErrorHandler);

const originalKey = process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY;

afterAll(() => {
  if (originalKey === undefined) delete process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY;
  else process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = originalKey;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = 'ab'.repeat(32);
  jest.mocked(findEventSubscription).mockResolvedValue({
    endpointUrl: 'https://example.test/events',
    key: 'example',
    hasToken: true,
    version: 1,
    updatedAt: '2025-07-18T00:00:00.000Z',
    updatedBy: 'Tester',
  });
  jest
    .mocked(findEncryptedEventSubscriptionToken)
    .mockImplementation(async () => encryptSubscriptionToken('saved-secret'));
});

describe('event subscription token reveal', () => {
  it('keeps the normal settings response free of secrets', async () => {
    const response = await request(app).get('/forms/f1/settings/event-subscription');
    expect(response.status).toBe(200);
    expect(response.body.hasToken).toBe(true);
    expect(response.body).not.toHaveProperty('token');
    expect(findEncryptedEventSubscriptionToken).not.toHaveBeenCalled();
  });

  it('requires form_update to reveal the token', async () => {
    const response = await request(app)
      .get('/forms/f1/settings/event-subscription/token')
      .set('x-deny', '1');
    expect(response.status).toBe(403);
    expect(findEncryptedEventSubscriptionToken).not.toHaveBeenCalled();
  });

  it('returns a saved token only on demand with caching disabled', async () => {
    const response = await request(app).get('/forms/f1/settings/event-subscription/token');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ token: 'saved-secret' });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(findEncryptedEventSubscriptionToken).toHaveBeenCalledWith('ws1', 'f1');
  });
});
