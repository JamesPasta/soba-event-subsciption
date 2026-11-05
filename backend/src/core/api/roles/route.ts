import express from 'express';
import { validateRequest } from '../shared/validation';
import { workspaceFromResource } from '../../middleware/workspaceContext';
import {
  requireWorkspaceManage,
  requireWorkspacePeopleRead,
} from '../../middleware/requireWorkspaceRole';
import {
  createWorkspaceRole,
  deleteWorkspaceRole,
  getWorkspaceRole,
  listWorkspaceRoles,
  updateWorkspaceRole,
} from './controller';
import {
  CreateRoleBodySchema,
  RoleCodeParamsSchema,
  UpdateRoleBodySchema,
  WorkspaceRoleParamsSchema,
} from './schema';

const router = express.Router();

const ROLES_PATH = '/workspaces/:id/roles';
const ROLE_PATH = '/workspaces/:id/roles/:roleCode';

// The same gates as groups: reads need an owner, admin or member role; writes need workspace
// management authority.
const workspaceResource = workspaceFromResource({ kind: 'workspace', idFrom: 'paramsId' });

router.get(
  ROLES_PATH,
  validateRequest({ params: WorkspaceRoleParamsSchema }),
  workspaceResource,
  requireWorkspacePeopleRead,
  listWorkspaceRoles,
);
router.get(
  ROLE_PATH,
  validateRequest({ params: RoleCodeParamsSchema }),
  workspaceResource,
  requireWorkspacePeopleRead,
  getWorkspaceRole,
);
router.post(
  ROLES_PATH,
  validateRequest({ params: WorkspaceRoleParamsSchema, body: CreateRoleBodySchema }),
  workspaceResource,
  requireWorkspaceManage,
  createWorkspaceRole,
);
router.patch(
  ROLE_PATH,
  validateRequest({ params: RoleCodeParamsSchema, body: UpdateRoleBodySchema }),
  workspaceResource,
  requireWorkspaceManage,
  updateWorkspaceRole,
);
router.delete(
  ROLE_PATH,
  validateRequest({ params: RoleCodeParamsSchema }),
  workspaceResource,
  requireWorkspaceManage,
  deleteWorkspaceRole,
);

export { router as rolesRouter };
