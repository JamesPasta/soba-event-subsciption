import { and, asc, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  featureStatus,
  formStatus,
  formVersionState,
  workspaceMembershipRole,
  workspaceMembershipStatus,
} from '../db/schema';

export interface CodeRow {
  code: string;
  display: string;
  sortOrder: number;
  isActive: boolean;
  source: string;
}

export interface RegisteredCodeSet {
  codeSet: string;
  providerType: string;
  featureCode: string | null;
}

const CODE_SOURCE_CORE = 'core';

const CODE_TABLES: Record<
  string,
  | typeof formStatus
  | typeof featureStatus
  | typeof formVersionState
  | typeof workspaceMembershipRole
  | typeof workspaceMembershipStatus
> = {
  feature_status: featureStatus,
  form_status: formStatus,
  form_version_state: formVersionState,
  workspace_membership_role: workspaceMembershipRole,
  workspace_membership_status: workspaceMembershipStatus,
};

type CodeTable = (typeof CODE_TABLES)[keyof typeof CODE_TABLES];

/** Rows included when source = 'core' or feature is enabled. */
function enabledSourceCondition(table: CodeTable) {
  return or(
    eq(table.source, CODE_SOURCE_CORE),
    sql`${table.source} IN (SELECT code FROM soba.feature WHERE status = 'enabled')`,
  );
}

const toRegisteredCodeSets = (codeSet: string, rows: { source: string }[]): RegisteredCodeSet[] =>
  rows.map((r) => ({
    codeSet,
    providerType: r.source === CODE_SOURCE_CORE ? 'core' : 'feature',
    featureCode: r.source === CODE_SOURCE_CORE ? null : r.source,
  }));

async function listCodeSetsOnlyEnabled(): Promise<RegisteredCodeSet[]> {
  const { features } = await import('../db/schema');
  const perSet = await Promise.all(
    Object.entries(CODE_TABLES).map(async ([codeSet, table]) => {
      const rows = await db
        .selectDistinct({ source: table.source })
        .from(table)
        .leftJoin(features, eq(table.source, features.code))
        .where(or(eq(table.source, CODE_SOURCE_CORE), eq(features.status, 'enabled')));
      return toRegisteredCodeSets(codeSet, rows);
    }),
  );
  return perSet.flat();
}

export class CodeService {
  async getRegisteredCodeSets(options?: {
    onlyEnabledFeatures?: boolean;
  }): Promise<RegisteredCodeSet[]> {
    if (options?.onlyEnabledFeatures !== false) {
      return listCodeSetsOnlyEnabled();
    }
    const perSet = await Promise.all(
      Object.entries(CODE_TABLES).map(async ([codeSet, table]) => {
        const rows = await db.selectDistinct({ source: table.source }).from(table);
        return toRegisteredCodeSets(codeSet, rows);
      }),
    );
    return perSet.flat();
  }

  async getCodes(
    codeSet: string,
    options?: { activeOnly?: boolean; onlyEnabledFeatures?: boolean },
  ): Promise<CodeRow[]> {
    const table = CODE_TABLES[codeSet];
    if (!table) return [];
    const onlyEnabled = options?.onlyEnabledFeatures !== false;
    const conditions = [
      ...(onlyEnabled ? [enabledSourceCondition(table)] : []),
      ...(options?.activeOnly === true ? [eq(table.isActive, true)] : []),
    ];
    // and() returns undefined for an empty list and the single condition for one, so it covers all cases.
    const where = and(...conditions);
    const rows = await db
      .select({
        code: table.code,
        display: table.display,
        sortOrder: table.sortOrder,
        isActive: table.isActive,
        source: table.source,
      })
      .from(table)
      .where(where)
      .orderBy(asc(table.sortOrder), asc(table.code));
    return rows as CodeRow[];
  }

  async getCode(
    codeSet: string,
    code: string,
    options?: { activeOnly?: boolean },
  ): Promise<CodeRow | null> {
    const table = CODE_TABLES[codeSet];
    if (!table) return null;
    const conditions = [
      eq(table.code, code),
      enabledSourceCondition(table),
      ...(options?.activeOnly === true ? [eq(table.isActive, true)] : []),
    ];
    const rows = await db
      .select({
        code: table.code,
        display: table.display,
        sortOrder: table.sortOrder,
        isActive: table.isActive,
        source: table.source,
      })
      .from(table)
      .where(and(...conditions))
      .limit(1);
    return (rows[0] as CodeRow) ?? null;
  }

  async isValidCode(
    codeSet: string,
    code: string,
    options?: { activeOnly?: boolean },
  ): Promise<boolean> {
    const row = await this.getCode(codeSet, code, options);
    return row !== null;
  }
}

export const codeService = new CodeService();
