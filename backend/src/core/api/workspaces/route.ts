import express from 'express';
import { validateRequest } from '../shared/validation';
import { sortLocale } from '../../middleware/sortLocale';
import { workspaceFromResource } from '../../middleware/workspaceContext';
import {
  listWorkspaces,
  lookupWorkspaces,
  createWorkspace,
  getWorkspaceById,
  updateWorkspace,
  checkWorkspaceNameAvailable,
} from './controller';
import {
  ListWorkspacesQuerySchema,
  CreateWorkspaceBodySchema,
  UpdateWorkspaceBodySchema,
  WorkspaceIdParamsSchema,
  WorkspaceLookupQuerySchema,
  WorkspaceNameAvailabilityQuerySchema,
} from './schema';

const router = express.Router();

// Actor-only: lists the workspaces the caller belongs to (no workspace context required).
router.get(
  '/workspaces',
  validateRequest({ query: ListWorkspacesQuerySchema }),
  sortLocale,
  listWorkspaces,
);
router.post('/workspaces', validateRequest({ body: CreateWorkspaceBodySchema }), createWorkspace);
// Registered before the `:id` route, which would otherwise take `lookup` as an id.
router.get(
  '/workspaces/lookup',
  validateRequest({ query: WorkspaceLookupQuerySchema }),
  sortLocale,
  lookupWorkspaces,
);
// Same reason: registered before `:id` so `name-availability` isn't taken as an id.
router.get(
  '/workspaces/name-availability',
  validateRequest({ query: WorkspaceNameAvailabilityQuerySchema }),
  checkWorkspaceNameAvailable,
);

router.get(
  '/workspaces/:id',
  workspaceFromResource({ kind: 'workspace', idFrom: 'paramsId' }),
  getWorkspaceById,
);
router.patch(
  '/workspaces/:id',
  validateRequest({ params: WorkspaceIdParamsSchema, body: UpdateWorkspaceBodySchema }),
  workspaceFromResource({ kind: 'workspace', idFrom: 'paramsId' }),
  updateWorkspace,
);

export { router as workspacesRouter };
