import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../errors';
import {
  isWorkspaceManageRole,
  isWorkspaceOwnerRole,
  isWorkspacePeopleReadRole,
} from '../db/repos/membershipRepo';

/**
 * Gates a route on the caller's workspace membership role. Runs after workspace resolution (needs
 * `req.coreContext`); responds 403 when `allows` refuses the role.
 */
const requireWorkspaceRole =
  (name: string, allows: (role: string | null) => boolean, refusal: string) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const context = req.coreContext;
    if (!context) {
      next(new Error(`${name} must run after workspace resolution`));
      return;
    }
    if (!allows(context.role)) {
      next(new ForbiddenError(refusal));
      return;
    }
    next();
  };

/** Owner only. */
export const requireWorkspaceOwner = requireWorkspaceRole(
  'requireWorkspaceOwner',
  isWorkspaceOwnerRole,
  'Requires the workspace owner role',
);

/** Owner or admin: workspace management. */
export const requireWorkspaceManage = requireWorkspaceRole(
  'requireWorkspaceManage',
  isWorkspaceManageRole,
  'Workspace management requires an owner or admin role',
);

/** Owner, admin or member: reading the workspace's members and groups. */
export const requireWorkspacePeopleRead = requireWorkspaceRole(
  'requireWorkspacePeopleRead',
  isWorkspacePeopleReadRole,
  "Reading the workspace's members and groups requires an owner, admin or member role",
);
