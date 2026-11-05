import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  type InferSelectModel,
  type SQL,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { ApiErrorCodes } from '@soba/lib';
import { ConflictError, NotFoundError } from '../../errors';
import { FIXED_ROLE_READ_ONLY, ROLE_IN_USE, ROLE_NOT_FOUND } from '../../messages';
import { db, type DbOrTx, type Tx } from '../client';
import {
  RoleAuditAction,
  RoleStatus,
  WorkspaceGroupRoleStatus,
  WorkspaceGroupStatus,
  type RoleAuditActionCode,
} from '../codes';
import {
  roleAudit,
  roles,
  features,
  rolePermissions,
  workspaceGroupRoles,
  workspaceGroups,
} from '../schema';
import { CODE_SOURCE_CORE, CODE_SOURCE_WORKSPACE } from '../schema/codes';

export type RoleRow = InferSelectModel<typeof roles>;

/** Who is writing to a workspace's own role, and in which workspace. */
export interface RoleWriteContext {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
}

export interface RoleWriteFields {
  name: string;
  permissionCodes: string[];
}

export interface ListRolesFilters {
  code?: string[];
  source?: string;
  status?: string;
  onlyEnabledFeatures?: boolean;
}

/** Resolved source for API: 'core' or the feature code. */
function sourceDisplay(role: { source: string; featureCode: string | null }): string {
  return role.source === CODE_SOURCE_CORE ? CODE_SOURCE_CORE : (role.featureCode ?? role.source);
}

export const getRoleByCode = async (
  code: string,
): Promise<(RoleRow & { sourceDisplay: string }) | null> => {
  const rows = await db
    .select()
    .from(roles)
    .where(and(eq(roles.code, code), isNull(roles.workspaceId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    source: row.source,
    sourceDisplay: sourceDisplay(row),
  };
};

/** Platform roles only. A workspace's own roles come from listRolesForWorkspace. */
export const listRoles = async (
  filters?: ListRolesFilters,
): Promise<(RoleRow & { sourceDisplay: string })[]> => {
  const {
    code: codeFilter,
    source: sourceFilter,
    status: statusFilter,
    onlyEnabledFeatures,
  } = filters ?? {};

  const conditions: (SQL | undefined)[] = [isNull(roles.workspaceId)];

  if (codeFilter?.length) {
    conditions.push(inArray(roles.code, codeFilter));
  }
  if (sourceFilter !== undefined) {
    if (sourceFilter === CODE_SOURCE_CORE) {
      conditions.push(eq(roles.source, CODE_SOURCE_CORE));
    } else {
      conditions.push(and(eq(roles.source, 'feature'), eq(roles.featureCode, sourceFilter)));
    }
  }
  if (statusFilter !== undefined) {
    conditions.push(eq(roles.status, statusFilter));
  }

  const baseWhere = and(...conditions);

  if (onlyEnabledFeatures === false) {
    const rows = await db.select().from(roles).where(baseWhere).orderBy(asc(roles.code));
    return rows.map((r) => ({
      ...r,
      sourceDisplay: sourceDisplay(r),
    }));
  }

  const enabledCondition = or(eq(roles.source, CODE_SOURCE_CORE), eq(features.status, 'enabled'));

  const rows = await db
    .select()
    .from(roles)
    .leftJoin(features, eq(roles.featureCode, features.code))
    .where(and(baseWhere, enabledCondition))
    .orderBy(asc(roles.code));

  return rows.map((r) => {
    const role = r.role;
    return {
      ...role,
      sourceDisplay: sourceDisplay(role),
    };
  });
};

const rolesUsableBy = (workspaceId: string, codes?: string[]) =>
  and(
    or(
      isNull(roles.workspaceId),
      and(eq(roles.workspaceId, workspaceId), ne(roles.status, RoleStatus.inactive)),
    ),
    codes ? inArray(roles.code, codes) : undefined,
  );

/**
 * The platform's roles, whatever their feature's state, and the workspace's own roles that are not
 * deleted. `codes` narrows the result.
 */
export const listRolesForWorkspace = (workspaceId: string, codes?: string[]): Promise<RoleRow[]> =>
  db.select().from(roles).where(rolesUsableBy(workspaceId, codes)).orderBy(asc(roles.code));

/**
 * Share-locks the given roles the workspace can use and returns their codes. Held until the
 * transaction ends, so a role can't be deleted while a new link to it is being written.
 */
export const lockRolesForWorkspace = async (
  tx: Tx,
  workspaceId: string,
  codes: string[],
): Promise<string[]> => {
  const rows = await tx
    .select({ code: roles.code })
    .from(roles)
    .where(rolesUsableBy(workspaceId, codes))
    .for('share');
  return rows.map((row) => row.code);
};

/** True if another of the workspace's active roles has this name. */
export const roleNameExistsInWorkspace = async (
  workspaceId: string,
  name: string,
  exceptRoleCode?: string,
): Promise<boolean> => {
  const rows = await db
    .select({ code: roles.code })
    .from(roles)
    .where(
      and(
        eq(roles.workspaceId, workspaceId),
        eq(roles.name, name),
        eq(roles.status, RoleStatus.active),
        exceptRoleCode ? ne(roles.code, exceptRoleCode) : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
};

/** Permission codes by role code, each list in code order. A role with none has no entry. */
export const listPermissionCodesByRole = async (
  roleCodes: string[],
  executor: DbOrTx = db,
): Promise<Map<string, string[]>> => {
  const byRole = new Map<string, string[]>();
  if (!roleCodes.length) return byRole;
  const rows = await executor
    .select({ roleCode: rolePermissions.roleCode, permissionCode: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleCode, roleCodes))
    .orderBy(asc(rolePermissions.permissionCode));
  for (const { roleCode, permissionCode } of rows) {
    byRole.set(roleCode, [...(byRole.get(roleCode) ?? []), permissionCode]);
  }
  return byRole;
};

/** What an audit row records of a role. */
const roleSnapshot = async (tx: Tx, roleCode: string, name: string) => {
  const permissions = await listPermissionCodesByRole([roleCode], tx);
  return { name, permissions: permissions.get(roleCode) ?? [] };
};

const writeRoleAudit = (
  tx: Tx,
  ctx: RoleWriteContext,
  entry: {
    roleCode: string;
    action: RoleAuditActionCode;
    before: Awaited<ReturnType<typeof roleSnapshot>> | null;
    after: Awaited<ReturnType<typeof roleSnapshot>> | null;
  },
) =>
  tx.insert(roleAudit).values({
    workspaceId: ctx.workspaceId,
    actorId: ctx.actorId,
    actorDisplayLabel: ctx.actorDisplayLabel,
    ...entry,
  });

const insertRolePermissions = (tx: Tx, roleCode: string, permissionCodes: string[]) =>
  tx
    .insert(rolePermissions)
    .values([...new Set(permissionCodes)].map((permissionCode) => ({ roleCode, permissionCode })));

/** Locks one of the workspace's own roles for a write. A fixed role is read-only. */
const lockOwnRole = async (tx: Tx, workspaceId: string, roleCode: string): Promise<RoleRow> => {
  const [role] = await tx.select().from(roles).where(eq(roles.code, roleCode)).for('no key update');
  if (role?.workspaceId === null) throw new ConflictError(FIXED_ROLE_READ_ONLY);
  if (role?.workspaceId !== workspaceId || role.status === RoleStatus.inactive) {
    throw new NotFoundError(ROLE_NOT_FOUND);
  }
  return role;
};

/** Creates one of the workspace's own roles; returns its code. */
export const createWorkspaceRole = (
  ctx: RoleWriteContext,
  fields: RoleWriteFields,
): Promise<string> =>
  db.transaction(async (tx) => {
    const roleCode = uuidv7();
    await tx.insert(roles).values({
      code: roleCode,
      name: fields.name,
      status: RoleStatus.active,
      source: CODE_SOURCE_WORKSPACE,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.actorDisplayLabel,
      updatedBy: ctx.actorDisplayLabel,
    });
    await insertRolePermissions(tx, roleCode, fields.permissionCodes);
    await writeRoleAudit(tx, ctx, {
      roleCode,
      action: RoleAuditAction.create,
      before: null,
      after: await roleSnapshot(tx, roleCode, fields.name),
    });
    return roleCode;
  });

/** Changes the name, the permissions or both, as one write. */
export const updateWorkspaceRole = (
  ctx: RoleWriteContext,
  roleCode: string,
  fields: Partial<RoleWriteFields>,
): Promise<void> =>
  db.transaction(async (tx) => {
    const role = await lockOwnRole(tx, ctx.workspaceId, roleCode);
    const before = await roleSnapshot(tx, roleCode, role.name);
    const name = fields.name ?? role.name;
    await tx
      .update(roles)
      .set({ name, updatedBy: ctx.actorDisplayLabel, updatedAt: new Date() })
      .where(eq(roles.code, roleCode));
    if (fields.permissionCodes) {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleCode, roleCode));
      await insertRolePermissions(tx, roleCode, fields.permissionCodes);
    }
    await writeRoleAudit(tx, ctx, {
      roleCode,
      action: RoleAuditAction.update,
      before,
      after: await roleSnapshot(tx, roleCode, name),
    });
  });

/** Soft-deletes one of the workspace's own roles. Refuses while an active group carries it. */
export const softDeleteWorkspaceRole = (ctx: RoleWriteContext, roleCode: string): Promise<void> =>
  db.transaction(async (tx) => {
    const role = await lockOwnRole(tx, ctx.workspaceId, roleCode);
    const carrying = await tx
      .select({ id: workspaceGroupRoles.id })
      .from(workspaceGroupRoles)
      .innerJoin(
        workspaceGroups,
        and(
          eq(workspaceGroups.id, workspaceGroupRoles.groupId),
          eq(workspaceGroups.status, WorkspaceGroupStatus.active),
        ),
      )
      .where(
        and(
          eq(workspaceGroupRoles.roleCode, roleCode),
          eq(workspaceGroupRoles.status, WorkspaceGroupRoleStatus.active),
        ),
      )
      .limit(1);
    if (carrying.length) throw new ConflictError(ROLE_IN_USE, ApiErrorCodes.role_in_use);
    await tx
      .update(roles)
      .set({
        status: RoleStatus.inactive,
        updatedBy: ctx.actorDisplayLabel,
        updatedAt: new Date(),
      })
      .where(eq(roles.code, roleCode));
    await writeRoleAudit(tx, ctx, {
      roleCode,
      action: RoleAuditAction.delete,
      before: await roleSnapshot(tx, roleCode, role.name),
      after: null,
    });
  });
