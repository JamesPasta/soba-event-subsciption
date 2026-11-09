'use client';

import { useCallback, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { v7 as uuidv7 } from 'uuid';
import type { FormType } from '@formio/react';
import {
  createFormVersion,
  createSobaFormioForm,
  getSobaForm,
  getSobaFormVersion,
  lookupFormVersions,
  publishSobaFormVersion,
  saveFormVersionSchema,
} from '@/src/shared/api/sobaApi';
import { updateSobaForm } from '@/src/shared/api/sobaApiDesign';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { DataError, WriteOutcome } from '@/src/shared/api/dataContracts';
import type {
  CreateFormFields,
  CreateSobaFormioFormResponse,
  FormVersionSummary,
  SobaFormType,
  SobaFormVersionType,
  SobaResponseFormType,
} from '@/src/types/forms';
import { versionsKey } from './useFormVersions';
import { formVersionSchemaKey, useFormVersionSchema } from './useFormVersionSchema';

const EMPTY_VERSIONS: FormVersionSummary[] = [];

/** The design read of a form, with the caller's permissions on it. */
export const designFormKey = (formId: string) => ['design-form', formId] as const;

/** The design read of a form; no id waits. */
export function useDesignFormRead(formId?: string) {
  return useAuthedSWR(
    formId ? designFormKey(formId) : null,
    (token) => getSobaForm(token, formId as string),
    sessionReadConfig,
  );
}

/** A form's versions for pickers, capped (see `truncated`); no id waits. */
export function useFormVersionLookup(formId?: string) {
  return useAuthedSWR(
    formId ? [...versionsKey(formId), 'lookup'] : null,
    (token) => lookupFormVersions(token, formId as string),
    sessionReadConfig,
  );
}

/**
 * What the designer is editing: the form, its current version, the selected version's schema, and
 * the unsaved edits layered over them. Edits are held apart from the loaded values so a
 * revalidation can never overwrite what the user has typed.
 */
export function useForm(formId?: string) {
  const { data: form, mutate: refreshForm, error: formError } = useDesignFormRead(formId);

  // Save and publish target this version, so it comes from the form and never from the options.
  const currentVersion: FormVersionSummary | null = form?.currentVersion ?? null;

  const { data: versionOptions, error: versionsError } = useFormVersionLookup(formId);
  const versions = Array.isArray(versionOptions?.items) ? versionOptions.items : EMPTY_VERSIONS;

  const [selectedVersionId, setSelectedVersionId] = useState<string>('current');
  const isHistoryView = selectedVersionId !== 'current';

  // Read by id, so the history tab can open a version the options stopped short of.
  const { data: selectedVersion, error: selectedVersionError } = useAuthedSWR(
    isHistoryView ? ['form-version', selectedVersionId] : null,
    (token) => getSobaFormVersion(token, selectedVersionId),
    sessionReadConfig,
  );
  const activeVersion: FormVersionSummary | null = isHistoryView
    ? (selectedVersion ?? null)
    : currentVersion;

  const {
    data: loadedSchema,
    isLoading: schemaLoading,
    error: schemaError,
  } = useFormVersionSchema(activeVersion?.id);

  const { mutate: globalMutate } = useSWRConfig();

  /**
   * The schema just written to a version, as the new cached value. Without this a save drops back
   * to the pre-save body: the read never revalidates, so the next save or new version would post
   * the schema as it was before the edits.
   */
  const commitSchema = useCallback(
    (versionId: string, next: FormType) =>
      globalMutate(formVersionSchemaKey(versionId), next, { revalidate: false }),
    [globalMutate],
  );

  /**
   * After a version write. The form carries the current version; the key prefix reaches the
   * version options and every page of the history table.
   */
  const refreshVersions = useCallback(async () => {
    if (!formId) return;
    const [prefix] = versionsKey(formId);
    await Promise.all([
      refreshForm(),
      globalMutate((key) => Array.isArray(key) && key[0] === prefix && key[1] === formId),
    ]);
  }, [globalMutate, formId, refreshForm]);

  // schemaError arrives already classified from useFormVersionSchema; the rest are raw.
  const rawError = formError ?? versionsError ?? selectedVersionError ?? null;
  const loadError: DataError | null = rawError ? classifyDataError(rawError) : schemaError;

  const [editedSchema, setEditedSchema] = useState<FormType | null>(null);
  const [editedName, setEditedName] = useState<string | null>(null);
  // The version the unsaved edits were made on. Saving them onto another version would overwrite it.
  const [editsBaseVersionId, setEditsBaseVersionId] = useState<string | null>(null);

  const activeVersionId = activeVersion?.id ?? null;
  const markEditsBase = useCallback(
    () => setEditsBaseVersionId((base) => base ?? activeVersionId),
    [activeVersionId],
  );
  const setSchema = useCallback(
    (next: FormType | null) => {
      setEditedSchema(next);
      markEditsBase();
    },
    [markEditsBase],
  );
  const setName = useCallback(
    (next: string) => {
      setEditedName(next);
      markEditsBase();
    },
    [markEditsBase],
  );

  const discardEdits = useCallback(() => {
    setEditedSchema(null);
    setEditedName(null);
    setEditsBaseVersionId(null);
  }, []);

  const currentVersionId = currentVersion?.id;
  const selectVersion = useCallback(
    (versionId: string) => {
      // The history table lists the current version too. Opening it there opens the draft.
      setSelectedVersionId(versionId === currentVersionId ? 'current' : versionId);
      discardEdits();
    },
    [discardEdits, currentVersionId],
  );

  return {
    form: form ?? null,
    versions,
    versionsTruncated: versionOptions?.truncated === true,
    versionsLimit: versionOptions?.limit,
    currentVersion,
    activeVersion,
    selectedVersionId,
    isHistoryView,
    historicalVersionNo: isHistoryView ? (activeVersion?.versionNo ?? null) : null,
    schema: editedSchema ?? loadedSchema ?? null,
    // The version the schema came from: the one the edits were made on, else the active version.
    schemaVersionId: (editedSchema === null ? null : editsBaseVersionId) ?? activeVersionId,
    name: editedName ?? form?.name ?? '',
    description: form?.description ?? '',
    isDirty: editedSchema !== null || editedName !== null,
    // Unsaved edits made on a version that is no longer the form's current one.
    editsStale:
      !isHistoryView && editsBaseVersionId !== null && editsBaseVersionId !== currentVersion?.id,
    // The draft is not assembled until the form, and any selected version, have answered. Until
    // then there is no schema key, so schemaLoading alone reports ready.
    // A read that failed has answered: these reads do not revalidate on their own, so reporting
    // loading here would leave the designer on a spinner for the life of the page.
    loading:
      !!formId &&
      !loadError &&
      (form === undefined || (isHistoryView && selectedVersion === undefined) || schemaLoading),
    error: loadError,
    setName,
    setSchema,
    discardEdits,
    commitSchema,
    selectVersion,
    refreshForm,
    refreshVersions,
  };
}

/**
 * Runs a create under ids minted for it. The key names the create, not its fields, so a retry sends
 * the same ids even after an edit and gets back what the first attempt made. A success or a refusal
 * releases them; after a network error or a 5xx the server may have committed, so they are kept.
 */
function usePendingIds<T>(mint: () => T) {
  const pending = useRef<{ key: string; ids: T } | null>(null);
  return useCallback(
    async <R>(key: string, request: (ids: T) => Promise<R>): Promise<R> => {
      if (pending.current?.key !== key) pending.current = { key, ids: mint() };
      try {
        const value = await request(pending.current.ids);
        pending.current = null;
        return value;
      } catch (err) {
        if (err instanceof ApiError && err.status < 500) pending.current = null;
        throw err;
      }
    },
    [mint],
  );
}

const mintVersionId = () => uuidv7();
const mintFormIds = () => ({ id: uuidv7(), versionId: uuidv7() });

/**
 * The write side of one form: its record, its version schemas, and new versions. Each action
 * refreshes the caches it affects (the form, the version list, and the schema just written), so a
 * component never refreshes by hand.
 */
export function useFormWriter(formId: string) {
  const { mutate } = useSWRConfig();

  const refreshForm = useCallback(() => mutate(designFormKey(formId)), [mutate, formId]);
  // The form carries the current version, so a new version changes it too: refresh both.
  const refreshVersions = useCallback(() => {
    const [prefix] = versionsKey(formId);
    return Promise.all([
      refreshForm(),
      mutate((key) => Array.isArray(key) && key[0] === prefix && key[1] === formId),
    ]);
  }, [mutate, formId, refreshForm]);
  // The schema just written, seeded into the cache so the next read does not drop back to the
  // pre-save body (these reads do not revalidate on their own).
  const commitSchema = useCallback(
    (versionId: string, schema: FormType) =>
      mutate(formVersionSchemaKey(versionId), schema, { revalidate: false }),
    [mutate],
  );

  const update = useCallback(
    async (
      token: string,
      patch: Partial<SobaFormType>,
    ): Promise<WriteOutcome<SobaResponseFormType>> => {
      const value = await updateSobaForm(token, formId, patch);
      await Promise.all([refreshForm(), mutate((key) => Array.isArray(key) && key[0] === 'forms')]);
      return { status: 'applied', value };
    },
    [mutate, formId, refreshForm],
  );

  const withNewVersionId = usePendingIds(mintVersionId);
  const withRestoreId = usePendingIds(mintVersionId);

  // With no schema, the server starts the draft from the source version's, else the default form.
  const createVersion = useCallback(
    async (
      token: string,
      sourceSchema: FormType | null,
      fromVersionId?: string,
    ): Promise<WriteOutcome<SobaFormVersionType>> => {
      const schema = sourceSchema ?? undefined;
      const { value, created } = await withNewVersionId(`${formId}:${fromVersionId}`, (id) =>
        createFormVersion(token, { id, formId, fromFormVersionId: fromVersionId, schema }),
      );
      // A retry got back the draft an earlier attempt made, maybe from an older schema: save this one.
      if (schema && !created) await saveFormVersionSchema(token, value.id, schema);
      if (schema) await commitSchema(value.id, schema);
      await refreshVersions();
      return { status: 'applied', value };
    },
    [formId, withNewVersionId, commitSchema, refreshVersions],
  );

  // The server starts the draft from the source version's schema.
  const restoreVersion = useCallback(
    async (token: string, fromVersionId: string): Promise<WriteOutcome<SobaFormVersionType>> => {
      const { value } = await withRestoreId(`${formId}:${fromVersionId}`, (id) =>
        createFormVersion(token, { id, formId, fromFormVersionId: fromVersionId }),
      );
      await refreshVersions();
      return { status: 'applied', value };
    },
    [formId, withRestoreId, refreshVersions],
  );

  const saveSchema = useCallback(
    async (
      token: string,
      versionId: string,
      schema: FormType,
      publish: boolean,
    ): Promise<WriteOutcome<void>> => {
      await saveFormVersionSchema(token, versionId, schema);
      if (publish) {
        await publishSobaFormVersion(token, versionId);
        await refreshVersions();
      }
      await commitSchema(versionId, schema);
      await refreshForm();
      return { status: 'applied', value: undefined };
    },
    [commitSchema, refreshVersions, refreshForm],
  );

  return { update, createVersion, restoreVersion, saveSchema };
}

/**
 * Create a new form with its first version, ready to open in the designer. One form per mounted
 * creator and workspace: a retry gets back the form an earlier attempt made, under its first name.
 */
export function useFormCreator() {
  const withFormIds = usePendingIds(mintFormIds);
  const create = useCallback(
    async (
      token: string,
      data: CreateFormFields,
      workspaceId?: string,
    ): Promise<WriteOutcome<CreateSobaFormioFormResponse>> => {
      // No schema: the server gives the first version the default form.
      const { value } = await withFormIds(workspaceId ?? '', (ids) =>
        createSobaFormioForm(token, { ...data, ...ids }, workspaceId),
      );
      return { status: 'applied', value };
    },
    [withFormIds],
  );
  return { create };
}
