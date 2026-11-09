import { and, count, eq, ilike, inArray, isNull, ne, type InferSelectModel } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { forms, formVersions, workspaces } from '../schema';
import { likePattern, orderByForSort, type SortColumns } from '../listSort';
import { readListPage } from '../listRead';
import { NotFoundError } from '../../errors';
import { listAllowsNothing, permittedFormsWhere, type FormAccessGrant } from './formAccessRepo';
import { liveForm } from './liveRows';

import { FORM_SORT_FIELDS, type SortLocale, type SortToken } from '@soba/lib';
export type FormListSortField = (typeof FORM_SORT_FIELDS)[number];
export type FormListSort = SortToken<FormListSortField>;

const FORM_SORT_COLUMNS: SortColumns<FormListSortField> = {
  name: { column: forms.name, linguistic: true },
  status: { column: forms.status },
  createdAt: { column: forms.createdAt },
  updatedAt: { column: forms.updatedAt },
};

export interface ListFormsForWorkspaceInput {
  /** The anchored workspace, or every workspace the actor is an active member of. */
  workspaceIds: string[];
  formAccess: FormAccessGrant;
  offset: number;
  limit: number;
  formId?: string;
  q?: string;
  status?: string;
  sort: FormListSort;
  locale: SortLocale;
}

export interface FormListRow {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  status: string;
  org: string;
  useCase: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export type FormRecord = InferSelectModel<typeof forms>;

interface CreateFormInput {
  /** Minted by the caller; a new UUIDv7 when absent. */
  id?: string;
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  formEngineCode: string;
  name: string;
  description?: string;
}

interface UpdateFormInput {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  formId: string;
  name?: string;
  description?: string | null;
  status?: string;
  org?: string;
  useCase?: string;
}

export const listFormsForWorkspace = async (
  input: ListFormsForWorkspaceInput,
): Promise<{ items: FormListRow[]; total: number }> => {
  if (listAllowsNothing(input.workspaceIds, input.formAccess)) {
    return { items: [], total: 0 };
  }
  const whereClauses = [
    inArray(forms.workspaceId, input.workspaceIds),
    liveForm,
    permittedFormsWhere(input.formAccess, {
      workspaceId: forms.workspaceId,
      formId: forms.id,
    }),
  ];

  if (input.status) {
    whereClauses.push(eq(forms.status, input.status));
  }

  if (input.formId) {
    whereClauses.push(eq(forms.id, input.formId));
  }

  if (input.q) {
    whereClauses.push(ilike(forms.name, likePattern(input.q)));
  }

  const where = and(...whereClauses);

  return readListPage(async (tx) => {
    const items = await tx
      .select({
        id: forms.id,
        workspaceId: forms.workspaceId,
        workspaceName: workspaces.name,
        name: forms.name,
        org: forms.org,
        useCase: forms.useCase,
        status: forms.status,
        createdAt: forms.createdAt,
        updatedAt: forms.updatedAt,
        createdBy: forms.createdBy,
        updatedBy: forms.updatedBy,
      })
      .from(forms)
      .innerJoin(workspaces, eq(workspaces.id, forms.workspaceId))
      .where(where)
      .orderBy(...orderByForSort(FORM_SORT_COLUMNS, input.sort, forms.id, input.locale))
      .limit(input.limit)
      .offset(input.offset);
    const totals = await tx.select({ total: count() }).from(forms).where(where);
    return { items, total: totals[0]?.total ?? 0 };
  });
};

export const getFormById = async (
  workspaceId: string,
  formId: string,
): Promise<FormRecord | null> => {
  const row = await db
    .select()
    .from(forms)
    .where(and(eq(forms.workspaceId, workspaceId), eq(forms.id, formId), isNull(forms.deletedAt)))
    .limit(1);

  return row[0] ?? null;
};

export const getFormByEngineSchemaRef = async (
  workspaceId: string,
  engineSchemaRef: string,
): Promise<FormRecord | null> => {
  const rows = await db
    .select({
      id: forms.id,
      workspaceId: forms.workspaceId,
      formEngineCode: forms.formEngineCode,
      name: forms.name,
      description: forms.description,
      org: forms.org,
      useCase: forms.useCase,
      status: forms.status,
      createdAt: forms.createdAt,
      updatedAt: forms.updatedAt,
      createdBy: forms.createdBy,
      updatedBy: forms.updatedBy,
      deletedAt: forms.deletedAt,
      deletedBy: forms.deletedBy,
    })
    .from(forms)
    .innerJoin(formVersions, eq(formVersions.formId, forms.id))
    .where(
      and(
        eq(forms.workspaceId, workspaceId),
        eq(formVersions.engineSchemaRef, engineSchemaRef),
        isNull(forms.deletedAt),
        isNull(formVersions.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
};

export const createForm = async (input: CreateFormInput, tx?: DbOrTx): Promise<FormRecord> => {
  const d = tx ?? db;

  const ws = await d
    .select({ org: workspaces.org, useCase: workspaces.useCase })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .limit(1);

  // A form's org and use case are seeded from its workspace and owned by the form after that.
  const workspace = ws[0];
  if (!workspace) {
    throw new NotFoundError(`Workspace not found: ${input.workspaceId}`);
  }

  const created = await d
    .insert(forms)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      formEngineCode: input.formEngineCode,
      name: input.name,
      description: input.description,
      org: workspace.org,
      useCase: workspace.useCase,
      status: 'active',
      createdBy: input.actorDisplayLabel,
      updatedBy: input.actorDisplayLabel,
    })
    .returning();

  return created[0] as FormRecord;
};

/** A form by id in any workspace, deleted included, for checking an id a caller minted. */
export const findFormAnywhere = async (
  formId: string,
): Promise<{ workspaceId: string; deletedAt: Date | null } | null> => {
  const rows = await db
    .select({ workspaceId: forms.workspaceId, deletedAt: forms.deletedAt })
    .from(forms)
    .where(eq(forms.id, formId))
    .limit(1);
  return rows[0] ?? null;
};

/** True if a non-deleted form with this name exists in the workspace (optionally excluding one form). */
export const formNameExistsInWorkspace = async (
  workspaceId: string,
  name: string,
  exceptFormId?: string,
): Promise<boolean> => {
  const rows = await db
    .select({ id: forms.id })
    .from(forms)
    .where(
      and(
        eq(forms.workspaceId, workspaceId),
        eq(forms.name, name),
        isNull(forms.deletedAt),
        ...(exceptFormId ? [ne(forms.id, exceptFormId)] : []),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
};

export const updateForm = async (input: UpdateFormInput): Promise<FormRecord | null> => {
  const updated = await db
    .update(forms)
    .set({
      name: input.name,
      description: input.description,
      status: input.status,
      org: input.org,
      useCase: input.useCase,
      updatedBy: input.actorDisplayLabel,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(forms.id, input.formId),
        eq(forms.workspaceId, input.workspaceId),
        isNull(forms.deletedAt),
      ),
    )
    .returning();

  return (updated[0] as FormRecord) ?? null;
};

export const markFormDeleted = async (
  workspaceId: string,
  formId: string,
  actorDisplayLabel: string | null,
) => {
  const updated = await db
    .update(forms)
    .set({
      status: 'deleted',
      deletedAt: new Date(),
      deletedBy: actorDisplayLabel,
      updatedBy: actorDisplayLabel,
      updatedAt: new Date(),
    })
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspaceId)))
    .returning();

  return updated[0] ?? null;
};

/**
 * Resolve list-scope context for a form by id alone. Returns null for missing/deleted forms.
 */
export const getFormListContext = async (
  formId: string,
): Promise<{ workspaceId: string } | null> => {
  const row = await db
    .select({ workspaceId: forms.workspaceId })
    .from(forms)
    .where(and(eq(forms.id, formId), liveForm))
    .limit(1);

  return row[0] ?? null;
};

/**
 * Resolve the workspace that owns a form, by form id alone. Used to derive request workspace
 * context for deep links. Neutral: returns null for missing/deleted forms (caller maps to 404);
 * access is still enforced downstream via membership.
 */
export const getWorkspaceIdForForm = async (formId: string): Promise<string | null> => {
  const context = await getFormListContext(formId);
  return context?.workspaceId ?? null;
};

export const getFormEngineCodeForForm = async (
  workspaceId: string,
  formId: string,
): Promise<string | null> => {
  const row = await db
    .select({ engineCode: forms.formEngineCode })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspaceId), eq(forms.id, formId), isNull(forms.deletedAt)))
    .limit(1);

  return row[0]?.engineCode ?? null;
};
