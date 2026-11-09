import { and, asc, eq, inArray, or, type InferSelectModel } from 'drizzle-orm';
import { db } from '../client';
import { roles, features } from '../schema';
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
  const rows = await db.select().from(roles).where(eq(roles.code, code)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    source: row.source,
    sourceDisplay: sourceDisplay(row),
  };
};

export const listRoles = async (
  filters?: ListRolesFilters,
): Promise<(RoleRow & { sourceDisplay: string })[]> => {
  const {
    code: codeFilter,
    source: sourceFilter,
    status: statusFilter,
    onlyEnabledFeatures,
  } = filters ?? {};

  const conditions = [];

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

  const baseWhere = conditions.length ? and(...conditions) : undefined;

  if (onlyEnabledFeatures === false) {
    const rows = await db.select().from(roles).where(baseWhere).orderBy(asc(roles.code));
    return rows.map((r) => ({
      ...r,
      sourceDisplay: sourceDisplay(r),
    }));
  }

  const enabledCondition = or(eq(roles.source, CODE_SOURCE_CORE), eq(features.status, 'enabled'));
  const whereClause = baseWhere ? and(baseWhere, enabledCondition) : enabledCondition;

  const rows = await db
    .select()
    .from(roles)
    .leftJoin(features, eq(roles.featureCode, features.code))
    .where(whereClause)
    .orderBy(asc(roles.code));

  return rows.map((r) => {
    const role = r.role;
    return {
      ...role,
      sourceDisplay: sourceDisplay(role),
    };
  });
};
