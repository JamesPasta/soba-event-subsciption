'use client';

import { useCallback, useId, useMemo } from 'react';
import { useSWRConfig } from 'swr';
import {
  fetchJobForms,
  fetchScopedJob,
  fetchScopedJobs,
  rerunScopedJob,
  stopScopedJob,
} from '@/src/shared/api/sobaApiJobs';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult, Resource, WriteOutcome } from '@/src/shared/api/dataContracts';
import type { ListQueryArgs } from '@/src/types/list';
import type {
  JobFormItem,
  JobScopeRef,
  StaffJobDetail,
  StaffJobFilters,
  StaffJobListItem,
} from '@/src/types/jobs';
import { clearJobLists, jobPollConfig, SCOPED_JOBS_KEY } from './jobReads';

const JOB_KEY = 'scoped-job';

const scopeId = (scope: JobScopeRef): string =>
  scope.kind === 'form' ? scope.formId : scope.workspaceId;

/** The jobs a form's or a workspace's submissions started, newest first unless sorted otherwise. */
export function useScopedJobs(
  scope: JobScopeRef,
  filters: StaffJobFilters,
  query: ListQueryArgs,
): ListResult<StaffJobListItem> {
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    [
      SCOPED_JOBS_KEY,
      scope.kind,
      scopeId(scope),
      filters.status ?? '',
      filters.type ?? '',
      filters.formId ?? '',
      query.offset,
      query.limit,
      query.sort,
    ],
    (token) => fetchScopedJobs(token, scope, { ...query, ...filters }),
    { ...listReadConfig, shouldRetryOnError: false },
  );

  const rows: StaffJobListItem[] = useMemo(() => data?.items ?? [], [data]);
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

/** The forms that have jobs in a workspace, read anew on each mount; undefined until read. */
export function useJobForms(workspaceId: string | null): JobFormItem[] | undefined {
  const readId = useId();
  const { data } = useAuthedSWR(
    workspaceId ? ['job-forms', workspaceId, readId] : null,
    (token) => fetchJobForms(token, workspaceId as string),
    { shouldRetryOnError: false },
  );
  return data?.items;
}

/**
 * One job in the scope, read anew on each mount and followed while it is queued or running. Null
 * `jobId` waits.
 */
export function useScopedJob(scope: JobScopeRef, jobId: string | null): Resource<StaffJobDetail> {
  const readId = useId();
  const { data, isLoading, error, mutate } = useAuthedSWR(
    jobId ? [JOB_KEY, scope.kind, scopeId(scope), jobId, readId] : null,
    (token) => fetchScopedJob(token, scope, jobId as string),
    jobPollConfig<StaffJobDetail>(),
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

/** Run a job in the scope again or stop it; the page shows the job the server returns. */
export function useScopedJobWriter(scope: JobScopeRef) {
  const { mutate } = useSWRConfig();
  const settle = useCallback(
    async (job: StaffJobDetail) => {
      await mutate((key) => Array.isArray(key) && key[0] === JOB_KEY && key[3] === job.id, job, {
        revalidate: false,
      });
      await clearJobLists(mutate);
    },
    [mutate],
  );
  const rerun = useCallback(
    async (token: string, jobId: string): Promise<WriteOutcome<StaffJobDetail>> => {
      const job = await rerunScopedJob(token, scope, jobId);
      await settle(job);
      return { status: 'applied', value: job };
    },
    [scope, settle],
  );
  const stop = useCallback(
    async (
      token: string,
      jobId: string,
    ): Promise<WriteOutcome<{ stopped: boolean; job: StaffJobDetail }>> => {
      const result = await stopScopedJob(token, scope, jobId);
      await settle(result.job);
      return { status: 'applied', value: result };
    },
    [scope, settle],
  );
  return { rerun, stop };
}
