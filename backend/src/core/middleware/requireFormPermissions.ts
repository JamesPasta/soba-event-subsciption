import type { NextFunction, Request, Response } from 'express';
import { hasAllPermissions } from '@soba/lib';
import { ForbiddenError } from '../errors';
import {
  formAccessGrantFor,
  resolveFormAccessGrant,
  resolveFormPermissions,
  resolveWorkspacePermissions,
} from '../db/repos/formAccessRepo';
import { getActiveWorkspaceIdsForUser } from '../db/repos/membershipRepo';
import type { PermissionCode } from '../db/codes';

/**
 * Gates a route on form permissions. Runs after workspace resolution. With a form in context the
 * caller's permissions on that form decide, otherwise their workspace permissions; 403 when any
 * required code is missing. A list that names no form is not refused: it gets the grant of forms
 * that hold every required code, and the list repos keep only those rows.
 */
export const requireFormPermissions = (required: readonly PermissionCode[]) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = req.coreContext;
      const listScope = req.listScope;
      if (listScope && !context?.formId) {
        if (!listScope.selectedWorkspaceId) {
          listScope.workspaceIds = await getActiveWorkspaceIdsForUser(listScope.actorId);
        }
        listScope.formAccess = await resolveFormAccessGrant(
          listScope.actorId,
          required,
          listScope.workspaceIds,
        );
        return next();
      }
      if (!context) {
        throw new Error('requireFormPermissions must run after workspace resolution');
      }
      const permissions = context.formId
        ? await resolveFormPermissions(context.actorId, context.workspaceId, context.formId)
        : await resolveWorkspacePermissions(context.actorId, context.workspaceId);
      if (!hasAllPermissions(permissions, required)) {
        throw new ForbiddenError('Insufficient form permissions');
      }
      context.permissions = permissions;
      if (listScope) {
        listScope.formAccess = formAccessGrantFor(context.formId);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};
