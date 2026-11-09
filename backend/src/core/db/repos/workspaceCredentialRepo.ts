import type {
  CredentialFields,
  CredentialStatus,
  CredentialType,
  CREDENTIAL_SORT_FIELDS,
  SortLocale,
  SortToken,
} from '@soba/lib';
import { and, count, eq, ilike, or, getTableColumns, isNull, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { readListPage } from '../listRead';
import { likePattern, orderByForSort, type SortColumns } from '../listSort';
import {
  credentialAudit,
  credentialTypeAssignments,
  workspaceCredentials,
} from '../schema/workspaceCredential';
import { sobaSchema } from '../schema/sobaSchema';
import type { IssuedApiKey } from '../../integrations/credential-issuer/CredentialIssuerAdapter';

/** Who a key belongs to: the workspace, or one of its forms. */
export type CredentialOwner = { workspaceId: string; formId: string | null };
/** The upstream operations a key reserves before it calls the issuer. */
export type CredentialOperation = 'issue' | 'regenerate' | 'delete';

export type CredentialListInput = {
  offset: number;
  limit: number;
  sort: SortToken<(typeof CREDENTIAL_SORT_FIELDS)[number]>;
  q?: string;
  locale: SortLocale;
};

export type CredentialRecord = typeof workspaceCredentials.$inferSelect & {
  types: CredentialType[];
};

// Drizzle leaves columns unqualified in a single-table select or returning, so the outer key's id
// is named in full; a bare "id" would bind to the subquery's table if it ever gained one.
const outerKeyId = sql`${sql.identifier(sobaSchema.schemaName)}.${sql.identifier('workspace_credential')}.${sql.identifier('id')}`;
const credentialSelection = {
  ...getTableColumns(workspaceCredentials),
  types: sql<CredentialType[]>`array(
    select ${credentialTypeAssignments.typeCode} from ${credentialTypeAssignments}
    where ${credentialTypeAssignments.credentialId} = ${outerKeyId}
    order by ${credentialTypeAssignments.typeCode}
  )`,
};

const live = isNull(workspaceCredentials.deletedAt);
const formIs = (formId: string | null) =>
  formId === null ? isNull(workspaceCredentials.formId) : eq(workspaceCredentials.formId, formId);
const ownedBy = (owner: CredentialOwner, id: string) =>
  and(
    eq(workspaceCredentials.workspaceId, owner.workspaceId),
    formIs(owner.formId),
    eq(workspaceCredentials.id, id),
    live,
  );
/** A form's list also holds its workspace's keys, which the form can read but not change. */
const visibleTo = (owner: CredentialOwner) =>
  and(
    eq(workspaceCredentials.workspaceId, owner.workspaceId),
    owner.formId === null
      ? isNull(workspaceCredentials.formId)
      : or(isNull(workspaceCredentials.formId), eq(workspaceCredentials.formId, owner.formId)),
    live,
  );

type KeyRef = { id: string; workspaceId: string };
const audit = (tx: DbOrTx, key: KeyRef, actorId: string, action: string) =>
  tx
    .insert(credentialAudit)
    .values({ workspaceId: key.workspaceId, credentialId: key.id, actorId, action });
const assignTypes = (tx: DbOrTx, key: KeyRef, types: CredentialType[]) =>
  tx
    .insert(credentialTypeAssignments)
    .values(
      types.map((typeCode) => ({ workspaceId: key.workspaceId, credentialId: key.id, typeCode })),
    );

const sortedTypes = (types: CredentialType[]) => [...types].sort((a, b) => a.localeCompare(b));

export const getWorkspaceCredential = async (
  owner: CredentialOwner,
  id: string,
): Promise<CredentialRecord | null> => {
  const [row] = await db
    .select(credentialSelection)
    .from(workspaceCredentials)
    .where(ownedBy(owner, id));
  return row ?? null;
};

const CREDENTIAL_SORT_COLUMNS: SortColumns<(typeof CREDENTIAL_SORT_FIELDS)[number]> = {
  label: { column: workspaceCredentials.label, linguistic: true },
  status: { column: workspaceCredentials.status },
  createdAt: { column: workspaceCredentials.createdAt },
};

export const listWorkspaceCredentials = (
  owner: CredentialOwner,
  query: CredentialListInput,
): Promise<{ items: CredentialRecord[]; total: number }> =>
  readListPage(async (tx) => {
    const where = and(
      visibleTo(owner),
      query.q
        ? or(
            ilike(workspaceCredentials.label, likePattern(query.q)),
            ilike(workspaceCredentials.notes, likePattern(query.q)),
          )
        : undefined,
    );
    const items = await tx
      .select(credentialSelection)
      .from(workspaceCredentials)
      .where(where)
      .orderBy(
        ...orderByForSort(
          CREDENTIAL_SORT_COLUMNS,
          query.sort,
          workspaceCredentials.id,
          query.locale,
        ),
      )
      .limit(query.limit)
      .offset(query.offset);
    const [totals] = await tx.select({ total: count() }).from(workspaceCredentials).where(where);
    return { items, total: totals?.total ?? 0 };
  });

/** Records a key as issuing before the issuer is called, so a lost response can be reconciled. */
export const reserveCredentialIssue = (
  owner: CredentialOwner,
  issuerCode: string,
  actorId: string,
  fields: CredentialFields,
): Promise<CredentialRecord> =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .insert(workspaceCredentials)
      .values({
        workspaceId: owner.workspaceId,
        formId: owner.formId,
        issuerCode,
        label: fields.label,
        notes: fields.notes,
        status: 'issuing',
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();
    if (!row) throw new Error('Credential reservation was not written');
    await assignTypes(tx, row, fields.types);
    await audit(tx, row, actorId, 'issue_started');
    return { ...row, types: sortedTypes(fields.types) };
  });

/** Moves an active key to rotating; null when it is missing or another operation holds it. */
export const reserveCredentialOperation = (
  owner: CredentialOwner,
  id: string,
  actorId: string,
  operation: Exclude<CredentialOperation, 'issue'>,
): Promise<CredentialRecord | null> =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .update(workspaceCredentials)
      .set({ status: 'rotating', updatedBy: actorId, updatedAt: new Date() })
      .where(and(ownedBy(owner, id), eq(workspaceCredentials.status, 'active')))
      .returning(credentialSelection);
    if (!row) return null;
    await audit(tx, row, actorId, `${operation}_started`);
    return row;
  });

const completion = (
  operation: CredentialOperation,
  credential: IssuedApiKey | null,
  actorId: string,
  now: Date,
) => {
  if (!credential) {
    if (operation !== 'delete') throw new Error('An issued credential is required');
    return { deletedAt: now, deletedBy: actorId };
  }
  if (operation === 'issue') return { clientId: credential.clientId, flow: credential.flow };
  if (operation === 'regenerate') return { rotatedAt: now };
  return { rotatedAt: now, deletedAt: now, deletedBy: actorId };
};

/**
 * Settles a reservation the issuer carried out. Only the consumer id and flow are taken from the
 * issuer's result; never spread it into persistence or audit events. A null `credential` is a
 * delete that found the consumer already gone.
 */
export const completeCredentialOperation = (
  record: CredentialRecord,
  actorId: string,
  operation: CredentialOperation,
  credential: IssuedApiKey | null,
): Promise<CredentialRecord> =>
  db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(workspaceCredentials)
      .set({
        ...completion(operation, credential, actorId, now),
        status: 'active',
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(
        and(eq(workspaceCredentials.id, record.id), eq(workspaceCredentials.status, record.status)),
      )
      .returning(credentialSelection);
    if (!row) throw new Error('Credential operation reservation changed');
    await audit(
      tx,
      row,
      actorId,
      credential ? `${operation}_completed` : 'delete_consumer_missing',
    );
    return row;
  });

/** Settles a reservation into `status`, unless something else has settled it first. */
const settleCredential = async (
  record: CredentialRecord,
  actorId: string,
  status: CredentialStatus,
  action: string,
): Promise<void> => {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workspaceCredentials)
      .set({ status, updatedBy: actorId, updatedAt: new Date() })
      .where(
        and(eq(workspaceCredentials.id, record.id), eq(workspaceCredentials.status, record.status)),
      )
      .returning({ id: workspaceCredentials.id, workspaceId: workspaceCredentials.workspaceId });
    if (row) await audit(tx, row, actorId, action);
  });
};

/** The issuer refused: a new key never existed, and an existing key still works. */
export const rejectCredentialOperation = (
  record: CredentialRecord,
  actorId: string,
  operation: CredentialOperation,
): Promise<void> =>
  settleCredential(
    record,
    actorId,
    operation === 'issue' ? 'failed' : 'active',
    `${operation}_rejected`,
  );

export const markCredentialUnknown = (
  record: CredentialRecord,
  actorId: string,
  operation: CredentialOperation,
): Promise<void> => settleCredential(record, actorId, 'unknown', `${operation}_unknown`);

export const updateCredentialFields = (
  owner: CredentialOwner,
  id: string,
  actorId: string,
  fields: CredentialFields,
): Promise<CredentialRecord | null> =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .update(workspaceCredentials)
      .set({ label: fields.label, notes: fields.notes, updatedBy: actorId, updatedAt: new Date() })
      .where(ownedBy(owner, id))
      .returning();
    if (!row) return null;
    await tx
      .delete(credentialTypeAssignments)
      .where(eq(credentialTypeAssignments.credentialId, id));
    await assignTypes(tx, row, fields.types);
    await audit(tx, row, actorId, 'fields_updated');
    return { ...row, types: sortedTypes(fields.types) };
  });

/** Deletes a key the issuer refused to create. Returns false when there is no such key. */
export const deleteFailedCredential = (
  owner: CredentialOwner,
  id: string,
  actorId: string,
): Promise<boolean> =>
  db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(workspaceCredentials)
      .set({ deletedAt: now, deletedBy: actorId, updatedBy: actorId, updatedAt: now })
      .where(and(ownedBy(owner, id), eq(workspaceCredentials.status, 'failed')))
      .returning({ id: workspaceCredentials.id, workspaceId: workspaceCredentials.workspaceId });
    if (!row) return false;
    await audit(tx, row, actorId, 'deleted');
    return true;
  });
