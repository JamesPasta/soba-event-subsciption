import type { Request, Response } from 'express';
import type { CreateUserFromSearchBody, UserSearchQuery } from '@soba/lib';
import {
  createUserFromSearch,
  getUserSearchCapabilities,
  searchUsers,
  type UserSearchPolicy,
} from './service';

// The design and workspace surfaces search every active login provider.
const STAFF_POLICY: UserSearchPolicy = {};

export async function getUserSearchCapabilitiesHandler(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await getUserSearchCapabilities(STAFF_POLICY, req.sortLocale!));
}

export async function searchUsersHandler(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const query = req.query as unknown as UserSearchQuery;
  res.json(await searchUsers(query, STAFF_POLICY, req.sortLocale!));
}

export async function createUserFromSearchHandler(
  req: Request<unknown, unknown, CreateUserFromSearchBody>,
  res: Response,
): Promise<void> {
  const ctx = req.coreContext!;
  const result = await createUserFromSearch(req.body, STAFF_POLICY, req.sortLocale!, {
    actorId: ctx.actorId,
    actorDisplayLabel: ctx.actorDisplayLabel,
  });
  res.status(result.created ? 201 : 200).json(result);
}
