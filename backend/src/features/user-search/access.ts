import type { RequestHandler } from 'express';
import { Permissions } from '../../core/db/codes';
import { isWorkspaceManageRole } from '../../core/db/repos/membershipRepo';
import { requireFormPermissions } from '../../core/middleware/requireFormPermissions';

const requireTeamUpdate = requireFormPermissions([Permissions.team_update]);

/**
 * Workspace owners and admins may search, and so may a team_update holder on the form in context
 * (on the workspace when there is no form). Runs after workspace resolution.
 */
export const requireUserSearchAccess: RequestHandler = (req, res, next) => {
  if (isWorkspaceManageRole(req.coreContext?.role ?? null)) {
    next();
  } else {
    void requireTeamUpdate(req, res, next);
  }
};
