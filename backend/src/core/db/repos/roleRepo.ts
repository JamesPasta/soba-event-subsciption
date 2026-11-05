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
import { db } from '../client';
import { RoleStatus } from '../codes';
import { roles, features, rolePermissions } from '../schema';
import { CODE_SOURCE_CORE } from '../schema/codes';

export type RoleRow = InferSelectModel<typeof roles>;

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

/**
 * The platform's roles, whatever their feature's state, and the workspace's own roles that are not
 * deleted. `codes` narrows the result.
 */
export const listRolesForWorkspace = (workspaceId: string, codes?: string[]): Promise<RoleRow[]> =>
  db
    .select()
    .from(roles)
    .where(
      and(
        or(
          isNull(roles.workspaceId),
          and(eq(roles.workspaceId, workspaceId), ne(roles.status, RoleStatus.inactive)),
        ),
        codes ? inArray(roles.code, codes) : undefined,
      ),
    )
    .orderBy(asc(roles.code));

/** Permission codes by role code, each list in code order. A role with none has no entry. */
export const listPermissionCodesByRole = async (
  roleCodes: string[],
): Promise<Map<string, string[]>> => {
  const byRole = new Map<string, string[]>();
  if (!roleCodes.length) return byRole;
  const rows = await db
    .select({ roleCode: rolePermissions.roleCode, permissionCode: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleCode, roleCodes))
    .orderBy(asc(rolePermissions.permissionCode));
  for (const { roleCode, permissionCode } of rows) {
    byRole.set(roleCode, [...(byRole.get(roleCode) ?? []), permissionCode]);
  }
  return byRole;
};
