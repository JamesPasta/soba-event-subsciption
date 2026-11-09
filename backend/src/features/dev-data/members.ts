import { v7 as uuidv7 } from 'uuid';

import { db } from '../../core/db/client';
import { workspaceMemberships } from '../../core/db/schema';
import {
  WorkspaceMembershipSource,
  WorkspaceMembershipStatus,
  type WorkspaceMembershipRoleCode,
  type WorkspaceMembershipStatusCode,
} from '../../core/db/codes';
import type { ResolvedUser } from './resolveUser';

/** Written directly: the members API is read-only and the owner bootstrap is private. */
export async function addMember(args: {
  workspaceId: string;
  user: ResolvedUser;
  role: WorkspaceMembershipRoleCode;
  invitedBy: ResolvedUser;
  status?: WorkspaceMembershipStatusCode;
}): Promise<string> {
  const membershipId = uuidv7();
  const now = new Date();
  await db.insert(workspaceMemberships).values({
    id: membershipId,
    workspaceId: args.workspaceId,
    userId: args.user.id,
    role: args.role,
    status: args.status ?? WorkspaceMembershipStatus.active,
    source: WorkspaceMembershipSource.user_created,
    invitedByUserId: args.invitedBy.id,
    invitedAt: now,
    acceptedAt: now,
    createdBy: args.invitedBy.displayLabel,
    updatedBy: args.invitedBy.displayLabel,
  });
  return membershipId;
}
