import { isDeepStrictEqual } from 'node:util';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { db, type DbOrTx } from '../client';
import { settingsAudit } from '../schema';

/** How a save of a settings row ended. `conflict` means the row moved on since the caller read it. */
export type SettingsSaveStatus = 'saved' | 'notFound' | 'conflict';

/** Who made a save the API takes; internal writes pass none and are not audited. */
export interface SettingsSaveActor {
  actorId: string | null;
}

/** Who saved which group, for the audit row. A workspace-level save has no form. */
export interface SettingsAuditEntry {
  workspaceId: string;
  formId: string | null;
  groupKey: string;
  actorId: string | null;
  actorDisplayLabel: string | null;
}

type VersionedTable = PgTable & { id: AnyPgColumn; version: AnyPgColumn };
type Row = Record<string, unknown>;

// Written on every save, so not part of what changed.
const BOOKKEEPING = new Set(['updatedAt', 'updatedBy']);

const pick = (row: Row, keys: string[]): Row =>
  Object.fromEntries(keys.map((key) => [key, row[key]]));

/** Appends one write of a settings row to the audit, on the connection that made the write. */
export const recordSettingsAudit = async (
  executor: DbOrTx,
  record: SettingsAuditEntry & { version: number; before: Row; after: Row },
): Promise<void> => {
  await executor.insert(settingsAudit).values(record);
};

/**
 * Writes `set` to the settings row `where` selects and moves its version on, but only while its
 * version is still `version`. Without a version the row is written whatever its version, which only
 * internal callers do. With `audit`, the same transaction records what changed. A save that changes
 * nothing writes nothing: the version stays and nothing is audited. The row is locked while it is
 * checked, so of two saves from one version only the first lands.
 */
export const saveSettingsRow = <T extends VersionedTable>(
  table: T,
  where: SQL,
  set: PgUpdateSetSource<T>,
  version?: number,
  audit?: SettingsAuditEntry,
): Promise<SettingsSaveStatus> =>
  db.transaction(async (tx) => {
    const [current] = (await tx
      .select()
      .from(table as PgTable)
      .where(where)
      .limit(1)
      .for('update')) as Row[];
    if (!current) return 'notFound';
    if (version !== undefined && current.version !== version) return 'conflict';

    const keys = Object.keys(set).filter((key) => !BOOKKEEPING.has(key));
    if (isDeepStrictEqual(pick(current, keys), pick(set as Row, keys))) return 'saved';

    const [saved] = (await tx
      .update(table)
      .set({ ...set, version: sql`${table.version} + 1` } as PgUpdateSetSource<T>)
      .where(eq(table.id, current.id as string))
      .returning()) as Row[];

    if (audit) {
      await recordSettingsAudit(tx, {
        ...audit,
        version: saved.version as number,
        before: pick(current, keys),
        after: pick(saved, keys),
      });
    }
    return 'saved';
  });
