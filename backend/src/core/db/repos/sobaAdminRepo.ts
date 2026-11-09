import { and, count, eq, ilike } from 'drizzle-orm';
import { SOBA_ADMIN_SORT_FIELDS, type SortLocale, type SortToken } from '@soba/lib';
import { db } from '../client';
import { appUsers, sobaAdmins } from '../schema';
import { likePattern, orderByForSort, type SortColumns } from '../listSort';
import { readListPage } from '../listRead';

export const SOBA_ADMIN_SOURCE_IDP = 'idp';
export const SOBA_ADMIN_SOURCE_DIRECT = 'direct';

export interface SobaAdminListRow {
  userId: string;
  source: string;
  identityProviderCode: string | null;
  syncedAt: Date | null;
  displayLabel: string | null;
}

export type SobaAdminListSortField = (typeof SOBA_ADMIN_SORT_FIELDS)[number];
export type SobaAdminListSort = SortToken<SobaAdminListSortField>;

const SOBA_ADMIN_SORT_COLUMNS: SortColumns<SobaAdminListSortField> = {
  // A user who has never signed in has no label yet.
  displayLabel: { column: appUsers.displayLabel, nullable: true, linguistic: true },
  source: { column: sobaAdmins.source },
  // Only an IdP-sourced grant is synced; a direct grant has no timestamp.
  syncedAt: { column: sobaAdmins.syncedAt, nullable: true },
};

export interface ListSobaAdminsInput {
  offset: number;
  limit: number;
  sort: SobaAdminListSort;
  locale: SortLocale;
  source?: string;
  q?: string;
}

/** List SOBA platform admins with user display label. */
export async function listSobaAdmins(
  input: ListSobaAdminsInput,
): Promise<{ items: SobaAdminListRow[]; total: number }> {
  const whereClauses = [];
  if (input.source) {
    whereClauses.push(eq(sobaAdmins.source, input.source));
  }
  if (input.q) {
    whereClauses.push(ilike(appUsers.displayLabel, likePattern(input.q)));
  }
  const where = whereClauses.length > 0 ? and(...whereClauses) : undefined;

  return readListPage(async (tx) => {
    const items = await tx
      .select({
        userId: sobaAdmins.userId,
        source: sobaAdmins.source,
        identityProviderCode: sobaAdmins.identityProviderCode,
        syncedAt: sobaAdmins.syncedAt,
        displayLabel: appUsers.displayLabel,
      })
      .from(sobaAdmins)
      .innerJoin(appUsers, eq(appUsers.id, sobaAdmins.userId))
      .where(where)
      .orderBy(
        ...orderByForSort(SOBA_ADMIN_SORT_COLUMNS, input.sort, sobaAdmins.userId, input.locale),
      )
      .limit(input.limit)
      .offset(input.offset);
    const totals = await tx
      .select({ total: count() })
      .from(sobaAdmins)
      .innerJoin(appUsers, eq(appUsers.id, sobaAdmins.userId))
      .where(where);
    return { items, total: totals[0]?.total ?? 0 };
  });
}

/**
 * Returns whether the user is a SOBA platform admin (from table: idp-sourced or direct).
 */
export async function isSobaAdmin(userId: string): Promise<boolean> {
  const row = await db
    .select({ userId: sobaAdmins.userId })
    .from(sobaAdmins)
    .where(eq(sobaAdmins.userId, userId))
    .limit(1);
  return Boolean(row[0]);
}

/** Grants platform admin from the IdP `idpCode`; any existing row, direct or IdP, is kept as it is. */
export async function grantSobaAdminFromIdp(
  userId: string,
  idpCode: string,
  actorDisplayLabel: string | null,
): Promise<void> {
  await db
    .insert(sobaAdmins)
    .values({
      userId,
      source: SOBA_ADMIN_SOURCE_IDP,
      identityProviderCode: idpCode,
      syncedAt: new Date(),
      createdBy: actorDisplayLabel,
      updatedBy: actorDisplayLabel,
    })
    .onConflictDoNothing({ target: sobaAdmins.userId });
}

/** Moves an IdP grant to the IdP `idpCode`, never a direct one. Whether a row was moved. */
export async function repointSobaAdminFromIdp(
  userId: string,
  idpCode: string,
  actorDisplayLabel: string | null,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(sobaAdmins)
    .set({
      identityProviderCode: idpCode,
      syncedAt: now,
      updatedAt: now,
      updatedBy: actorDisplayLabel,
    })
    .where(and(eq(sobaAdmins.userId, userId), eq(sobaAdmins.source, SOBA_ADMIN_SOURCE_IDP)));
  return (result.rowCount ?? 0) > 0;
}

/** Removes the grant the IdP `idpCode` gave, never a direct one. Whether a row was removed. */
export async function revokeSobaAdminFromIdp(userId: string, idpCode: string): Promise<boolean> {
  const result = await db
    .delete(sobaAdmins)
    .where(
      and(
        eq(sobaAdmins.userId, userId),
        eq(sobaAdmins.source, SOBA_ADMIN_SOURCE_IDP),
        eq(sobaAdmins.identityProviderCode, idpCode),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Manually add (or pin) a user as SOBA admin (source='direct').
 * An idp-sourced row becomes direct so they remain admin even if the IdP revokes.
 * user_id is a foreign key to app_user, so the caller must confirm the user exists.
 */
export async function addDirectSobaAdmin(
  userId: string,
  addedByDisplayLabel: string | null,
): Promise<void> {
  await db
    .insert(sobaAdmins)
    .values({
      userId,
      source: SOBA_ADMIN_SOURCE_DIRECT,
      identityProviderCode: null,
      syncedAt: null,
      createdBy: addedByDisplayLabel,
      updatedBy: addedByDisplayLabel,
    })
    .onConflictDoUpdate({
      target: sobaAdmins.userId,
      set: {
        source: SOBA_ADMIN_SOURCE_DIRECT,
        identityProviderCode: null,
        syncedAt: null,
        updatedAt: new Date(),
        updatedBy: addedByDisplayLabel,
      },
    });
}

/**
 * Remove a direct SOBA admin grant. No-op if user is not in table or source is not 'direct'.
 */
export async function removeDirectSobaAdmin(userId: string): Promise<boolean> {
  const result = await db
    .delete(sobaAdmins)
    .where(and(eq(sobaAdmins.userId, userId), eq(sobaAdmins.source, SOBA_ADMIN_SOURCE_DIRECT)));
  return (result.rowCount ?? 0) > 0;
}
