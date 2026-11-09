import type { NextFunction, Request, Response } from 'express';
import { ApiErrorCodes } from '@soba/lib';
import { NotFoundError } from '../errors';
import { isFeatureEnabledCached } from '../db/repos/featureRepo';
import type { FeatureCode } from '../db/codes';

/**
 * Gates a mounted feature surface (e.g. /api/v1/design, /api/v1/submit): when the feature is disabled
 * the whole surface responds 404, as if the routes did not exist. Status is cached (see featureRepo),
 * so a feature can be toggled without a restart. Runs after auth so it never leaks feature state to
 * an unauthorized caller before the surface's own authorization.
 */
export const requireFeature = (code: FeatureCode) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const enabled = await isFeatureEnabledCached(code, Date.now());
      if (!enabled) {
        throw new NotFoundError('Not found', ApiErrorCodes.route_not_found);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};
