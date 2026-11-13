import type { RequestHandler } from 'express';
import passport from 'passport';
import { ApiErrorCodes } from '@soba/lib';
import { getToken } from '../auth/IdpPlugin';
import { SOBA_PASSPORT_STRATEGY } from '../auth/passport';

const unauthorizedResponse = {
  error: 'Unauthorized',
  code: ApiErrorCodes.unauthenticated,
  message: 'Error occurred during authentication',
  statusCode: 401,
};

/**
 * Passport-backed IdP auth middleware; rejects with 401 when no plugin authenticates. With
 * `allowPublic`, a request that sends no bearer continues unauthenticated (req.user stays unset).
 * A bearer that fails verification is refused either way.
 */
export const checkJwt = (opts: { allowPublic?: boolean } = {}): RequestHandler => {
  return (req, res, next) => {
    passport.authenticate(
      SOBA_PASSPORT_STRATEGY,
      { session: false },
      (err: unknown, user: Express.User | false | null, info?: { error?: unknown }) => {
        if (err) return next(err);
        if (!user) {
          if (opts.allowPublic && !getToken(req)) return next();
          if (info?.error) return next(info.error);
          return res.status(401).json(unauthorizedResponse);
        }
        req.user = user;
        next();
      },
    )(req, res, next);
  };
};
