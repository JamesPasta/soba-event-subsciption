import { ApiErrorCodes, type SortLocale } from '@soba/lib';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { GROUP_NAME_TAKEN } from '../../messages';
import { listRoles } from '../../db/repos/roleRepo';
import {
  addGroupMember,
  createWorkspaceGroup,
  getWorkspaceGroup,
  getWorkspaceGroupMeta,
  groupNameExistsInWorkspace,
  isUserInGroup,
  listWorkspaceGroups,
  membershipInWorkspace,
  removeGroupMember,
  renameGroup,
  replaceGroupRoles,
  softDeleteWorkspaceGroup,
  type WorkspaceGroupListSort,
  type WorkspaceGroupRow,
} from '../../db/repos/workspaceGroupRepo';

export interface GroupsContextInput {
  workspaceId: string;
  actorDisplayLabel: string | null;
  locale: SortLocale;
}

export type AddMemberInput = { kind: 'user'; membershipId: string };

const GROUP_NOT_FOUND = 'Group not found';

/** Rejects role codes that don't exist in the catalog (enabled or feature-disabled). */
async function assertRolesExist(roleCodes: string[]): Promise<void> {
  const codes = [...new Set(roleCodes)];
  if (!codes.length) return;
  const found = await listRoles({ code: codes, onlyEnabledFeatures: false });
  const known = new Set(found.map((r) => r.code));
  const missing = codes.filter((c) => !known.has(c));
  if (missing.length) {
    throw new ValidationError(`Unknown role code(s): ${missing.join(', ')}`);
  }
}

/** Asserts the group is active in the workspace and returns its systemCode (null for user-created). */
async function requireGroup(workspaceId: string, groupId: string): Promise<string | null> {
  const meta = await getWorkspaceGroupMeta(workspaceId, groupId);
  if (!meta) {
    throw new NotFoundError(GROUP_NOT_FOUND);
  }
  return meta.systemCode;
}

/** Rejects a name already taken by another active group in the workspace. */
async function assertNameFree(
  workspaceId: string,
  name: string,
  exceptGroupId?: string,
): Promise<void> {
  if (await groupNameExistsInWorkspace(workspaceId, name, exceptGroupId)) {
    throw new ConflictError(GROUP_NAME_TAKEN, ApiErrorCodes.group_name_taken);
  }
}

async function loadGroup(ctx: GroupsContextInput, groupId: string): Promise<WorkspaceGroupRow> {
  const group = await getWorkspaceGroup(ctx.workspaceId, groupId, ctx.locale);
  if (!group) {
    throw new NotFoundError(GROUP_NOT_FOUND);
  }
  return group;
}

export class GroupsApiService {
  async list(
    ctx: GroupsContextInput,
    query: { offset: number; limit: number; sort: WorkspaceGroupListSort; q?: string },
  ) {
    const { items, total } = await listWorkspaceGroups({
      workspaceId: ctx.workspaceId,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
      locale: ctx.locale,
      q: query.q,
    });
    return {
      items,
      page: { offset: query.offset, limit: query.limit, total },
      filters: { q: query.q },
      sort: query.sort,
    };
  }

  get(ctx: GroupsContextInput, groupId: string) {
    return loadGroup(ctx, groupId);
  }

  async create(
    ctx: GroupsContextInput,
    input: { name: string; description?: string; roleCodes: string[] },
  ) {
    await assertNameFree(ctx.workspaceId, input.name);
    await assertRolesExist(input.roleCodes);
    const groupId = await createWorkspaceGroup({
      workspaceId: ctx.workspaceId,
      name: input.name,
      description: input.description,
      roleCodes: input.roleCodes,
      displayLabel: ctx.actorDisplayLabel,
    });
    return loadGroup(ctx, groupId);
  }

  async rename(
    ctx: GroupsContextInput,
    groupId: string,
    input: { name?: string; description?: string | null },
  ) {
    await requireGroup(ctx.workspaceId, groupId);
    if (input.name !== undefined) {
      await assertNameFree(ctx.workspaceId, input.name, groupId);
    }
    await renameGroup({
      groupId,
      name: input.name,
      description: input.description,
      displayLabel: ctx.actorDisplayLabel,
    });
    return loadGroup(ctx, groupId);
  }

  async remove(ctx: GroupsContextInput, groupId: string) {
    const systemCode = await requireGroup(ctx.workspaceId, groupId);
    if (systemCode) {
      throw new ConflictError('System groups cannot be deleted');
    }
    await softDeleteWorkspaceGroup({ groupId, displayLabel: ctx.actorDisplayLabel });
  }

  async setRoles(ctx: GroupsContextInput, groupId: string, roleCodes: string[]) {
    const systemCode = await requireGroup(ctx.workspaceId, groupId);
    if (systemCode) {
      throw new ConflictError('System group roles cannot be changed');
    }
    await assertRolesExist(roleCodes);
    await replaceGroupRoles({
      workspaceId: ctx.workspaceId,
      groupId,
      roleCodes,
      displayLabel: ctx.actorDisplayLabel,
    });
    return loadGroup(ctx, groupId);
  }

  async addMember(ctx: GroupsContextInput, groupId: string, input: AddMemberInput) {
    await requireGroup(ctx.workspaceId, groupId);
    await addUserMember(ctx, groupId, input.membershipId);
    return loadGroup(ctx, groupId);
  }

  async removeMember(ctx: GroupsContextInput, groupId: string, memberId: string) {
    await requireGroup(ctx.workspaceId, groupId);
    const removed = await removeGroupMember({ workspaceId: ctx.workspaceId, groupId, memberId });
    if (!removed) {
      throw new NotFoundError('Group member not found');
    }
    return loadGroup(ctx, groupId);
  }
}

async function addUserMember(
  ctx: GroupsContextInput,
  groupId: string,
  membershipId: string,
): Promise<void> {
  if (!(await membershipInWorkspace(ctx.workspaceId, membershipId))) {
    throw new ValidationError('Membership is not an active member of the workspace');
  }
  if (await isUserInGroup(groupId, membershipId)) {
    throw new ConflictError('Member already in group');
  }
  await addGroupMember({
    workspaceId: ctx.workspaceId,
    groupId,
    membershipId,
    displayLabel: ctx.actorDisplayLabel,
  });
}

export const groupsApiService = new GroupsApiService();
