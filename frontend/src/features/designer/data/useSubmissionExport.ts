'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSWRConfig, type SWRConfiguration } from 'swr';
import {
  getSobaExportFields,
  listSobaSubmissionExports,
  startSobaSubmissionExport,
  stopSobaSubmissionExport,
} from '@/src/shared/api/sobaApi';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig, sessionReadConfig } from '@/src/shared/api/swrConfig';
import type { ListQueryArgs } from '@/src/types/list';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult, Resource, WriteOutcome } from '@/src/shared/api/dataContracts';
import { pollEvery } from '@/src/features/jobs/data/jobReads';
import {
  isActiveExportStatus,
  type StartSubmissionExportBody,
  type SubmissionExport,
  type SubmissionExportFieldsBody,
  type SubmissionExportFieldsResponse,
  type SubmissionExportList,
} from '@/src/types/submissionExport';
import type { FormVersionSummary } from '@/src/types/forms';
import { useDesignFormRead, useFormVersionLookup } from './useForm';

const EMPTY: SubmissionExport[] = [];

const EXPORTS_KEY = 'submission-exports';

/** Every cached page of the form's exports. */
const isExportsPage = (formId: string) => (key: unknown) =>
  Array.isArray(key) && key[0] === EXPORTS_KEY && key[1] === formId;

/** The form's name and versions, from the designer's cached reads. */
export function useExportForm(
  formId: string,
): Resource<{ name: string; versions: FormVersionSummary[] }> {
  const form = useDesignFormRead(formId);
  const versions = useFormVersionLookup(formId);
  const error = form.error ?? versions.error;
  return {
    data:
      form.data && versions.data ? { name: form.data.name, versions: versions.data.items } : null,
    isLoading: form.isLoading || versions.isLoading,
    error: error ? classifyDataError(error) : null,
    refresh: async () => {
      await Promise.all([form.mutate(), versions.mutate()]);
    },
  };
}

const EXPORT_FIELDS_KEY = 'submission-export-fields';

let exportFieldReads = 0;
const nextExportFieldRead = () => {
  exportFieldReads += 1;
  return exportFieldReads;
};

/**
 * The fields an export with these filters can include; null filters wait. Publishing or a new
 * submission changes the answer, so each visit and filter change reads under its own key, and
 * `data` is null until that read answers.
 */
export function useExportFields(
  formId: string,
  filters: SubmissionExportFieldsBody | null,
): Resource<SubmissionExportFieldsResponse> {
  const filtersText = filters && JSON.stringify(filters);
  const key = useMemo(
    () => (filtersText ? [EXPORT_FIELDS_KEY, formId, filtersText, nextExportFieldRead()] : null),
    [formId, filtersText],
  );
  const { data, isLoading, error, mutate } = useAuthedSWR(
    key,
    (token) => getSobaExportFields(token, formId, filters!),
    sessionReadConfig,
  );
  const { mutate: globalMutate } = useSWRConfig();
  // Drops earlier answers and discards a read still running; those keys are not used again.
  useEffect(() => {
    if (!key) return;
    const isEarlierRead = (other: unknown) =>
      Array.isArray(other) && other[0] === EXPORT_FIELDS_KEY && other[3] !== key[3];
    void globalMutate(isEarlierRead, undefined, { revalidate: false });
  }, [globalMutate, key]);
  return {
    data: data ?? null,
    isLoading,
    error: error ? classifyDataError(error) : null,
    refresh: async () => {
      await mutate();
    },
  };
}

const anyActive = (latest: SubmissionExportList) =>
  latest.items.some((item) => isActiveExportStatus(item.status));

/**
 * One page of the caller's exports of the form, read again every few seconds while any on it is
 * queued or running. A failed read again keeps the rows already shown.
 */
export function useSubmissionExports(
  formId: string,
  query: ListQueryArgs,
): ListResult<SubmissionExport> {
  // SWR decides whether to poll only when its options change, and first decides before the first
  // read, so the options follow this flag rather than the data.
  const [active, setActive] = useState(false);
  const config = useMemo<SWRConfiguration<SubmissionExportList>>(
    () => ({
      ...listReadConfig,
      ...pollEvery(active),
      onSuccess: (latest: SubmissionExportList) => setActive(anyActive(latest)),
    }),
    [active],
  );
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    [EXPORTS_KEY, formId, query.offset, query.limit, query.sort],
    (token) =>
      listSobaSubmissionExports(token, formId, {
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
      }),
    config,
  );
  const rows = useMemo(() => data?.items ?? EMPTY, [data]);
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);
  return {
    rows,
    total: data?.page.total,
    isLoading,
    isRefreshing: isValidating && data !== undefined,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}

/**
 * Stop one of the caller's exports; a failure throws. The answer goes into the list at once, then
 * the list is read again. `stopped` is false while a running export has yet to stop.
 */
export function useSubmissionExportStopper(formId: string) {
  const { mutate } = useSWRConfig();
  const stop = useCallback(
    async (
      token: string,
      exportId: string,
    ): Promise<WriteOutcome<{ stopped: boolean; export: SubmissionExport }>> => {
      const value = await stopSobaSubmissionExport(token, formId, exportId);
      // Every cached page that shows it; a page not shown has no data to change.
      await mutate<SubmissionExportList>(
        isExportsPage(formId),
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) => (item.id === exportId ? value.export : item)),
          },
        { revalidate: true },
      );
      return { status: 'applied', value };
    },
    [formId, mutate],
  );
  return { stop };
}

/** Start an export; a failure throws. Refreshes the list of exports. */
export function useSubmissionExportStarter(formId: string) {
  const { mutate } = useSWRConfig();
  const start = useCallback(
    async (
      token: string,
      body: StartSubmissionExportBody,
    ): Promise<WriteOutcome<SubmissionExport>> => {
      const value = await startSobaSubmissionExport(token, formId, body);
      // The page shown reads again; another reads again when it is shown.
      await mutate(isExportsPage(formId));
      return { status: 'applied', value };
    },
    [formId, mutate],
  );
  return { start };
}
