import { Response } from 'express';
import { z } from 'zod';
import { groupsApiService } from './service';
import { withSortLocale } from '../../middleware/sortLocale';
import { asyncHandler } from '../shared/asyncHandler';
import type { Request } from 'express';
import {
  AddGroupMemberBodySchema,
  CreateGroupBodySchema,
  GroupIdParamsSchema,
  GroupMemberParamsSchema,
  ListGroupsQuerySchema,
  SetGroupRolesBodySchema,
  UpdateGroupBodySchema,
} from './schema';

type ListGroupsQuery = z.infer<typeof ListGroupsQuerySchema>;
type CreateGroupBody = z.infer<typeof CreateGroupBodySchema>;
type UpdateGroupBody = z.infer<typeof UpdateGroupBodySchema>;
type SetGroupRolesBody = z.infer<typeof SetGroupRolesBodySchema>;
type AddGroupMemberBody = z.infer<typeof AddGroupMemberBodySchema>;
type GroupIdParams = z.infer<typeof GroupIdParamsSchema>;
type GroupMemberParams = z.infer<typeof GroupMemberParamsSchema>;

export const listGroups = asyncHandler(async (req: Request, res: Response) => {
  const result = await groupsApiService.list(
    withSortLocale(req),
    req.query as unknown as ListGroupsQuery,
  );
  res.json(result);
});

export const getGroup = asyncHandler(async (req: Request<GroupIdParams>, res: Response) => {
  const result = await groupsApiService.get(withSortLocale(req), req.params.groupId);
  res.json(result);
});

export const createGroup = asyncHandler(
  async (req: Request<unknown, unknown, CreateGroupBody>, res: Response) => {
    const ctx = withSortLocale(req);
    const result = await groupsApiService.create(ctx, req.body);
    res.status(201).json(result);
  },
);

export const updateGroup = asyncHandler(
  async (req: Request<GroupIdParams, unknown, UpdateGroupBody>, res: Response) => {
    const ctx = withSortLocale(req);
    const result = await groupsApiService.rename(ctx, req.params.groupId, req.body);
    res.json(result);
  },
);

export const deleteGroup = asyncHandler(async (req: Request<GroupIdParams>, res: Response) => {
  const ctx = withSortLocale(req);
  await groupsApiService.remove(ctx, req.params.groupId);
  res.status(204).send();
});

export const setGroupRoles = asyncHandler(
  async (req: Request<GroupIdParams, unknown, SetGroupRolesBody>, res: Response) => {
    const ctx = withSortLocale(req);
    const result = await groupsApiService.setRoles(ctx, req.params.groupId, req.body.roleCodes);
    res.json(result);
  },
);

export const addGroupMember = asyncHandler(
  async (req: Request<GroupIdParams, unknown, AddGroupMemberBody>, res: Response) => {
    const ctx = withSortLocale(req);
    const result = await groupsApiService.addMember(ctx, req.params.groupId, req.body);
    res.json(result);
  },
);

export const removeGroupMember = asyncHandler(
  async (req: Request<GroupMemberParams>, res: Response) => {
    const ctx = withSortLocale(req);
    const result = await groupsApiService.removeMember(
      ctx,
      req.params.groupId,
      req.params.memberId,
    );
    res.json(result);
  },
);
