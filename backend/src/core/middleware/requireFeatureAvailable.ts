import type { NextFunction, Request, Response } from 'express';
import { ApiErrorCodes } from '@soba/lib';
import { NotFoundError } from '../errors';
import { isFeatureAvailable } from '../services/featureAvailabilityService';
import type { FeatureScopeContext } from '../services/featureAvailabilityService';
import type { FeatureCode } from '../db/codes';

export type FeatureScopeResolver = (req: Request) => FeatureScopeContext;

// Default: workspace from the resolved core context. Like the other coreContext-dependent guards
// (requireFormPermissions / requireWorkspaceManage), fail loud when it's missing so a mis-ordered
// mount surfaces as a clear error rather than a silent 404 on a scoped feature. Routes without a
// workspace context (e.g. a public surface scoped by request body) pass their own getScope.
const scopeFromCoreContext: FeatureScopeResolver = (req) => {
  const context = req.coreContext;
  if (!context) {
    throw new Error('requireFeatureAvailable must run after workspace resolution');
  }
  return { workspaceId: context.workspaceId };
};

/**
 * Gates a mounted surface on feature availability for the request's scope. Mirrors requireFeature —
 * 404 when unavailable, as if the routes did not exist — but consults the 3-gate resolver: a `fixed`
 * feature behaves exactly like requireFeature, while a `scoped` feature additionally requires an
 * active workspace/form grant. Pass `getScope` to source the scope from params/body/query instead of
 * the core context (e.g. a form id from the route).
 */
export const requireFeatureAvailable = (
  code: FeatureCode,
  getScope: FeatureScopeResolver = scopeFromCoreContext,
) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const available = await isFeatureAvailable(code, getScope(req));
      if (!available) {
        throw new NotFoundError('Not found', ApiErrorCodes.route_not_found);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};
