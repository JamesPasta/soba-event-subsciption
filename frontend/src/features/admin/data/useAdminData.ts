'use client';

import { useCallback, useEffect, useId, useMemo } from 'react';
import {
  addSobaAdmin,
  fetchDocumentGenerationAudits,
  fetchFeatureScope,
  fetchFeatureScopes,
  fetchJob,
  fetchJobs,
  fetchJobTypes,
  fetchSobaAdmins,
  removeFeatureScope,
  removeSobaAdmin,
  rerunJob,
  stopJob,
  upsertFeatureScope,
} from '@/src/shared/api/sobaApiAdmin';
import { useSWRConfig } from 'swr';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig, sessionReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import { ADMIN_JOBS_KEY, clearJobLists, jobPollConfig } from '@/src/features/jobs/data/jobReads';
import type { ListResult, Resource, WriteOutcome } from '@/src/shared/api/dataContracts';
import type { ListQueryArgs } from '@/src/types/list';
import type {
  DocumentGenerationAuditItem,
  FeatureScopeItem,
  JobDetail,
  JobFilters,
  JobListItem,
  JobTypeItem,
  SobaAdminItem,
  UpsertFeatureScopeBody,
} from '@/src/types/admin';
import { useSortLocale } from '@/src/shared/list/useSortLocale';

const scopeKey = (featureScopeId: string) => ['feature-scope', featureScopeId];

/**
 * A failed reload leaves the table showing the rows it already had, where the table's own error
 * state is not reached, so these reads report the failure to the caller. Retrying would report it
 * again for the same load.
 */
const reportOnce = (onError: (cause: unknown) => void) => ({
  shouldRetryOnError: false,
  onError,
});

export function useSobaAdmins(query: ListQueryArgs): ListResult<SobaAdminItem> {
  const locale = useSortLocale();
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    ['soba-admins', query.offset, query.limit, query.sort, query.q ?? '', locale],
    (token) => fetchSobaAdmins(token, { ...query, locale }),
    { ...listReadConfig, shouldRetryOnError: false },
  );

  const rows: SobaAdminItem[] = useMemo(() => data?.items ?? [], [data]);
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    rows,
    total: data?.page?.total,
    isLoading,
    isRefreshing: isValidating && data !== undefined,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}

/**
 * The server applies the allow-list, so the total it reports is the total the table can show.
 */
export function useFeatureScopes(
  allowedFeatureCodes: string[],
  query: ListQueryArgs,
): ListResult<FeatureScopeItem> {
  const codes = useMemo(
    () => [...allowedFeatureCodes].sort((a, b) => a.localeCompare(b)).join(','),
    [allowedFeatureCodes],
  );
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    allowedFeatureCodes.length > 0
      ? ['feature-scopes', codes, query.offset, query.limit, query.sort, query.q ?? '']
      : null,
    (token) => fetchFeatureScopes(token, { ...query, featureCodes: allowedFeatureCodes }),
    { ...listReadConfig, shouldRetryOnError: false },
  );

  const rows: FeatureScopeItem[] = useMemo(() => data?.items ?? [], [data]);
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    rows,
    total: data?.page?.total,
    isLoading,
    isRefreshing: isValidating && data !== undefined,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}

/**
 * Audits for one workspace or form. The endpoint requires one of them, so there is no read until
 * the admin has searched.
 */
export function useDocumentGenerationAudits(
  filter: { workspaceId?: string; formId?: string } | null,
  query: ListQueryArgs,
): ListResult<DocumentGenerationAuditItem> {
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    filter
      ? [
          'docgen-audits',
          filter.workspaceId ?? '',
          filter.formId ?? '',
          query.offset,
          query.limit,
          query.sort,
        ]
      : null,
    (token) => fetchDocumentGenerationAudits(token, { ...query, ...filter }),
    { ...listReadConfig, shouldRetryOnError: false },
  );

  const rows: DocumentGenerationAuditItem[] = useMemo(() => data?.items ?? [], [data]);
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    rows,
    total: data?.page?.total,
    isLoading,
    isRefreshing: isValidating && data !== undefined,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}

export function useFeatureScope(
  featureScopeId: string | undefined,
  enabled: boolean,
  onError: (cause: unknown) => void,
) {
  const { data, isLoading, error } = useAuthedSWR(
    featureScopeId && enabled ? scopeKey(featureScopeId) : null,
    (token) => fetchFeatureScope(token, featureScopeId as string),
    reportOnce(onError),
  );

  const { mutate } = useSWRConfig();
  useEffect(() => {
    if (!featureScopeId) return;
    return () => {
      // Clears the record and SWR's request marker, so the next mount reads it again.
      mutate(scopeKey(featureScopeId), undefined).catch(() => undefined);
    };
  }, [featureScopeId, mutate]);

  return { featureScope: data ?? null, isLoading, error: error ? classifyDataError(error) : null };
}

/** Add or remove a platform administrator. */
export function useSobaAdminWriter() {
  const { mutate } = useSWRConfig();
  const refresh = useCallback(
    () => mutate((key) => Array.isArray(key) && key[0] === 'soba-admins'),
    [mutate],
  );
  const add = useCallback(
    async (token: string, userId: string): Promise<WriteOutcome<void>> => {
      await addSobaAdmin(token, userId);
      await refresh();
      return { status: 'applied', value: undefined };
    },
    [refresh],
  );
  const remove = useCallback(
    async (token: string, userId: string): Promise<WriteOutcome<void>> => {
      await removeSobaAdmin(token, userId);
      await refresh();
      return { status: 'applied', value: undefined };
    },
    [refresh],
  );
  return { add, remove };
}

const JOBS_KEY = ADMIN_JOBS_KEY;
const JOB_KEY = 'admin-job';

/** Background jobs across every workspace, newest first unless sorted otherwise. */
export function useJobs(filters: JobFilters, query: ListQueryArgs): ListResult<JobListItem> {
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    [
      JOBS_KEY,
      filters.status ?? '',
      filters.type ?? '',
      filters.workspaceId ?? '',
      filters.formId ?? '',
      filters.submissionId ?? '',
      query.offset,
      query.limit,
      query.sort,
    ],
    (token) => fetchJobs(token, { ...query, ...filters }),
    { ...listReadConfig, shouldRetryOnError: false },
  );

  const rows: JobListItem[] = useMemo(() => data?.items ?? [], [data]);
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    rows,
    total: data?.page?.total,
    isLoading,
    isRefreshing: isValidating && data !== undefined,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}

/** The job types this environment runs. They change only with a deployment. */
export function useJobTypes(enabled = true): JobTypeItem[] {
  const { data } = useAuthedSWR(
    enabled ? ['admin-job-types'] : null,
    (token) => fetchJobTypes(token),
    sessionReadConfig,
  );
  return useMemo(() => data?.items ?? [], [data]);
}

/**
 * One job, read anew on each mount, and again every few seconds while it is queued or running so
 * its page follows it to the end. Null `jobId` waits, such as until the admin check settles.
 */
export function useJob(jobId: string | null): Resource<JobDetail> {
  const readId = useId();
  const { data, isLoading, error, mutate } = useAuthedSWR(
    jobId ? [JOB_KEY, jobId, readId] : null,
    (token) => fetchJob(token, jobId as string),
    jobPollConfig<JobDetail>(),
  );
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);
  return {
    data: data ?? null,
    isLoading,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}

/** Run a job again or stop it; the page shows the job the server returns, and lists read again. */
export function useJobWriter() {
  const { mutate } = useSWRConfig();
  const settle = useCallback(
    async (job: JobDetail) => {
      await mutate((key) => Array.isArray(key) && key[0] === JOB_KEY && key[1] === job.id, job, {
        revalidate: false,
      });
      await clearJobLists(mutate);
    },
    [mutate],
  );
  const rerun = useCallback(
    async (token: string, jobId: string): Promise<WriteOutcome<JobDetail>> => {
      const job = await rerunJob(token, jobId);
      await settle(job);
      return { status: 'applied', value: job };
    },
    [settle],
  );
  const stop = useCallback(
    async (
      token: string,
      jobId: string,
    ): Promise<WriteOutcome<{ stopped: boolean; job: JobDetail }>> => {
      const result = await stopJob(token, jobId);
      await settle(result.job);
      return { status: 'applied', value: result };
    },
    [settle],
  );
  return { rerun, stop };
}

/** Create, update or remove a feature scope. */
export function useFeatureScopeWriter() {
  const { mutate } = useSWRConfig();
  const refresh = useCallback(
    () => mutate((key) => Array.isArray(key) && key[0] === 'feature-scopes'),
    [mutate],
  );
  const upsert = useCallback(
    async (token: string, body: UpsertFeatureScopeBody): Promise<WriteOutcome<void>> => {
      await upsertFeatureScope(token, body);
      await refresh();
      return { status: 'applied', value: undefined };
    },
    [refresh],
  );
  const remove = useCallback(
    async (token: string, id: string): Promise<WriteOutcome<void>> => {
      await removeFeatureScope(token, id);
      await refresh();
      return { status: 'applied', value: undefined };
    },
    [refresh],
  );
  return { upsert, remove };
}
