import express from 'express';
import { validateRequest } from '../shared/validation';
import { sortLocale } from '../../middleware/sortLocale';
import { workspaceFromQuery } from '../../middleware/workspaceContext';
import { requireWorkspacePeopleRead } from '../../middleware/requireWorkspaceRole';
import { listMembers } from './controller';
import { ListMembersQuerySchema } from './schema';

const router = express.Router();

router.get(
  '/',
  validateRequest({ query: ListMembersQuerySchema }),
  sortLocale,
  workspaceFromQuery,
  requireWorkspacePeopleRead,
  listMembers,
);

export { router as membersRouter };
