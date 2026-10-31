import express from 'express';
import { validateRequest } from '../shared/validation';
import { SortLocaleQuerySchema } from '../shared/offsetPagination';
import { sortLocale } from '../../middleware/sortLocale';
import { workspaceFromResource } from '../../middleware/workspaceContext';
import { requireWorkspaceManage } from '../../middleware/requireWorkspaceRole';
import { addAccess, getAccess, listAccess, removeAccess, setAccessGroups } from './controller';
import {
  AccessMemberParamsSchema,
  AccessWorkspaceParamsSchema,
  AddAccessBodySchema,
  ListAccessQuerySchema,
  SetAccessGroupsBodySchema,
} from './schema';

const router = express.Router();

const MEMBERS_PATH = '/workspaces/:id/members';
const MEMBER_PATH = '/workspaces/:id/members/:membershipId';
const MEMBER_GROUPS_PATH = '/workspaces/:id/members/:membershipId/groups';

// Reads need workspace management too: the rows carry email addresses.
const workspaceResource = workspaceFromResource({ kind: 'workspace', idFrom: 'paramsId' });

router.get(
  MEMBERS_PATH,
  validateRequest({ query: ListAccessQuerySchema, params: AccessWorkspaceParamsSchema }),
  sortLocale,
  workspaceResource,
  requireWorkspaceManage,
  listAccess,
);
router.get(
  MEMBER_PATH,
  validateRequest({ query: SortLocaleQuerySchema, params: AccessMemberParamsSchema }),
  sortLocale,
  workspaceResource,
  requireWorkspaceManage,
  getAccess,
);
router.post(
  MEMBERS_PATH,
  validateRequest({
    query: SortLocaleQuerySchema,
    params: AccessWorkspaceParamsSchema,
    body: AddAccessBodySchema,
  }),
  sortLocale,
  workspaceResource,
  requireWorkspaceManage,
  addAccess,
);
router.put(
  MEMBER_GROUPS_PATH,
  validateRequest({
    query: SortLocaleQuerySchema,
    params: AccessMemberParamsSchema,
    body: SetAccessGroupsBodySchema,
  }),
  sortLocale,
  workspaceResource,
  requireWorkspaceManage,
  setAccessGroups,
);
router.delete(
  MEMBER_PATH,
  validateRequest({ query: SortLocaleQuerySchema, params: AccessMemberParamsSchema }),
  sortLocale,
  workspaceResource,
  requireWorkspaceManage,
  removeAccess,
);

export { router as accessRouter };
