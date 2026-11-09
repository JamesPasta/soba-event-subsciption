import { Response } from 'express';
import { z } from 'zod';
import { accessApiService } from './service';
import { withSortLocale } from '../../middleware/sortLocale';
import { asyncHandler } from '../shared/asyncHandler';
import type { Request } from 'express';
import {
  AccessMemberParamsSchema,
  AddAccessBodySchema,
  ListAccessQuerySchema,
  SetAccessGroupsBodySchema,
} from './schema';

type ListAccessQuery = z.infer<typeof ListAccessQuerySchema>;
type AddAccessBody = z.infer<typeof AddAccessBodySchema>;
type SetAccessGroupsBody = z.infer<typeof SetAccessGroupsBodySchema>;
type AccessMemberParams = z.infer<typeof AccessMemberParamsSchema>;

export const listAccess = asyncHandler(async (req: Request, res: Response) => {
  const result = await accessApiService.list(
    withSortLocale(req),
    req.query as unknown as ListAccessQuery,
  );
  res.json(result);
});

export const getAccess = asyncHandler(async (req: Request<AccessMemberParams>, res: Response) => {
  const result = await accessApiService.get(withSortLocale(req), req.params.membershipId);
  res.json(result);
});

export const addAccess = asyncHandler(
  async (req: Request<unknown, unknown, AddAccessBody>, res: Response) => {
    const result = await accessApiService.add(withSortLocale(req), req.body);
    res.status(201).json(result);
  },
);

export const setAccessGroups = asyncHandler(
  async (req: Request<AccessMemberParams, unknown, SetAccessGroupsBody>, res: Response) => {
    const result = await accessApiService.setGroups(
      withSortLocale(req),
      req.params.membershipId,
      req.body.groupIds,
    );
    res.json(result);
  },
);

export const removeAccess = asyncHandler(
  async (req: Request<AccessMemberParams>, res: Response) => {
    await accessApiService.remove(withSortLocale(req), req.params.membershipId);
    res.status(204).send();
  },
);
