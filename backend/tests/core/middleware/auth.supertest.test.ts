import express from 'express';
import passport from 'passport';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { checkJwt } from '../../../src/core/middleware/auth';
import { globalRateLimit } from '../../../src/core/middleware/rateLimit';
import { initializePassport, resetPassportForTests } from '../../../src/core/auth/passport';
import { getIdpPlugins } from '../../../src/core/auth/idpRegistry';
import { getToken } from '../../../src/core/auth/IdpPlugin';

jest.mock('../../../src/core/auth/idpRegistry', () => ({
  getIdpPlugins: jest.fn(),
}));

const getIdpPluginsMock = jest.mocked(getIdpPlugins);

interface MockPlugin {
  code: string;
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  claimMapper: {
    mapPayload: (payload: Record<string, unknown>) => {
      subject: string;
      providerCode: string;
      profile: Record<string, unknown>;
      idpAttributes: Record<string, unknown>;
      sobaAdmin?: boolean;
    };
  };
}

function createPlugin(
  code: string,
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  providerCode = code,
): MockPlugin {
  return {
    code,
    middleware,
    claimMapper: {
      mapPayload: (payload: Record<string, unknown>) => ({
        subject: String(payload.sub ?? `${code}-subject`),
        providerCode,
        profile: { displayLabel: `${code}-user` },
        idpAttributes: payload,
      }),
    },
  };
}

// Same shape as the real plugins: no bearer passes through, a bearer is verified or refused.
const verifyingPlugin = createPlugin('verifying-idp', (req, _res, next) => {
  const token = getToken(req);
  if (!token) return next();
  if (token !== 'good') return next(Object.assign(new Error('bad token'), { status: 401 }));
  req.idpPluginCode = 'verifying-idp';
  req.authPayload = { sub: 'user-3' };
  next();
});

function createApp() {
  const app = express();
  // Same global limiter as app.ts.
  app.use(globalRateLimit);
  initializePassport();
  app.use(passport.initialize());
  const echoUser: express.RequestHandler = (req, res) => {
    res.json({
      pluginCode: req.idpPluginCode,
      userPluginCode: req.user?.pluginCode ?? null,
      subject: req.user?.subject ?? null,
    });
  };
  app.get('/protected', checkJwt(), echoUser);
  app.get('/public', checkJwt({ allowPublic: true }), echoUser);
  app.use((err: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
    void next;
    res.status(err.status ?? 500).json({ message: err.message });
  });
  return app;
}

describe('checkJwt Passport wrapper', () => {
  beforeEach(() => {
    resetPassportForTests();
    jest.clearAllMocks();
  });

  it('authenticates with the first successful plugin', async () => {
    getIdpPluginsMock.mockReturnValue([
      createPlugin('first-idp', (req, _res, next) => {
        req.idpPluginCode = 'first-idp';
        req.authPayload = { sub: 'user-1' };
        next();
      }),
      createPlugin('second-idp', (_req, _res, next) => next()),
    ] as never[]);

    const res = await request(createApp()).get('/protected');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pluginCode: 'first-idp',
      userPluginCode: 'first-idp',
      subject: 'user-1',
    });
  });

  it('falls through to later plugins until one authenticates', async () => {
    const secondMiddleware = jest.fn((req: Request, _res: Response, next: NextFunction) => {
      req.idpPluginCode = 'second-idp';
      req.authPayload = { sub: 'user-2' };
      next();
    });

    getIdpPluginsMock.mockReturnValue([
      createPlugin('first-idp', (_req, _res, next) => next()),
      createPlugin('second-idp', secondMiddleware),
    ] as never[]);

    const res = await request(createApp()).get('/protected');

    expect(secondMiddleware).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('user-2');
  });

  it('clears stale plugin state before trying the next plugin', async () => {
    const unauthorizedError = Object.assign(new Error('bad token'), { status: 401 });

    getIdpPluginsMock.mockReturnValue([
      createPlugin('first-idp', (req, _res, next) => {
        req.idpPluginCode = 'first-idp';
        req.authPayload = { sub: 'stale-user' };
        next(unauthorizedError);
      }),
      createPlugin('second-idp', (_req, _res, next) => next()),
    ] as never[]);

    const res = await request(createApp()).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'bad token' });
  });

  it('returns a generic 401 response when no plugin authenticates', async () => {
    getIdpPluginsMock.mockReturnValue([
      createPlugin('first-idp', (_req, _res, next) => next()),
      createPlugin('second-idp', (_req, _res, next) => next()),
    ] as never[]);

    const res = await request(createApp()).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'Unauthorized',
      code: 'unauthenticated',
      message: 'Error occurred during authentication',
      statusCode: 401,
    });
  });

  it('with allowPublic, continues anonymously when no bearer is sent', async () => {
    getIdpPluginsMock.mockReturnValue([verifyingPlugin] as never[]);

    const res = await request(createApp()).get('/public');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userPluginCode: null, subject: null });
  });

  it('with allowPublic, refuses a bearer that fails verification', async () => {
    getIdpPluginsMock.mockReturnValue([verifyingPlugin] as never[]);

    const res = await request(createApp()).get('/public').set('Authorization', 'Bearer x');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'bad token' });
  });

  it('with allowPublic, refuses a bearer that no plugin recognises', async () => {
    getIdpPluginsMock.mockReturnValue([
      createPlugin('first-idp', (_req, _res, next) => next()),
    ] as never[]);

    const res = await request(createApp()).get('/public').set('Authorization', 'Bearer x');

    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe(401);
  });

  it('with allowPublic, authenticates a valid bearer', async () => {
    getIdpPluginsMock.mockReturnValue([verifyingPlugin] as never[]);

    const res = await request(createApp()).get('/public').set('Authorization', 'Bearer good');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pluginCode: 'verifying-idp',
      userPluginCode: 'verifying-idp',
      subject: 'user-3',
    });
  });
});
