import express from 'express';
import { validateRequest } from '../shared/validation';
import { workspaceFromResource } from '../../middleware/workspaceContext';
import { requireWorkspacePeopleRead } from '../../middleware/requireWorkspaceRole';
import { listWorkspaceRoles } from './controller';
import { WorkspaceRoleParamsSchema } from './schema';

const router = express.Router();

const workspaceResource = workspaceFromResource({ kind: 'workspace', idFrom: 'paramsId' });

router.get(
  '/workspaces/:id/roles',
  validateRequest({ params: WorkspaceRoleParamsSchema }),
  workspaceResource,
  requireWorkspacePeopleRead,
  listWorkspaceRoles,
);

export { router as rolesRouter };
