'use client';

import { useCallback, useMemo } from 'react';
import { useSWRConfig } from 'swr';
import {
  deleteSubmitSubmission,
  getMySubmissions,
  reviseSubmitSubmission,
} from '@/src/shared/api/sobaApi';
import { useUnsavedId } from '@/src/shared/hooks/useUnsavedId';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { useCallToken } from '@/src/shared/api/callToken';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult, WriteOutcome } from '@/src/shared/api/dataContracts';
import type { ListQueryArgs } from '@/src/types/list';
import type {
  ListMySubmissionsResponse,
  MySubmissionRow,
  MySubmissionState,
} from '@/src/types/submissions';
import { useSortLocale } from '@/src/shared/list/useSortLocale';

const KEY = 'my-submissions';
const EMPTY: MySubmissionRow[] = [];

/**
 * One page of the caller's own draft and submitted submissions, optionally of one state, each with
 * its form's facts from the same response.
 */
export function useMySubmissions(
  query: ListQueryArgs,
  workflowState: MySubmissionState | undefined,
): ListResult<MySubmissionRow> {
  const locale = useSortLocale();
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR<ListMySubmissionsResponse>(
    [KEY, query.offset, query.limit, query.sort, query.q ?? '', workflowState ?? '', locale],
    (token) =>
      getMySubmissions(token, {
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
        q: query.q,
        locale,
        workflowState,
      }),
    listReadConfig,
  );

  const rows: MySubmissionRow[] = useMemo(() => {
    if (!Array.isArray(data?.items)) return EMPTY;
    const forms = new Map((data.forms ?? []).map((form) => [form.id, form]));
    return data.items.map((item) => ({ ...item, form: forms.get(item.formId) ?? null }));
  }, [data]);
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
 * Delete one of the caller's own unsubmitted submissions, then re-read the list. Signed in only: a
 * session left with no token throws SessionExpiredError and sends nothing.
 */
export function useMySubmissionDeleter() {
  const { mutate } = useSWRConfig();
  const { signedInToken } = useCallToken();
  const remove = useCallback(
    async (submissionId: string): Promise<WriteOutcome<void>> => {
      const token = signedInToken();
      try {
        await deleteSubmitSubmission(token, submissionId);
        return { status: 'applied', value: undefined };
      } finally {
        // A refused delete still re-reads: the row may have been submitted elsewhere.
        await mutate((key) => Array.isArray(key) && key[0] === KEY);
      }
    },
    [mutate, signedInToken],
  );
  return { remove };
}

/**
 * Send one of the caller's own submitted submissions back to revise, then re-read the list. A retry
 * of the same submission reuses its id until it is saved, so it is made once.
 */
export function useMySubmissionReviser() {
  const { mutate } = useSWRConfig();
  const { signedInToken } = useCallToken();
  const unsaved = useUnsavedId();
  const revise = useCallback(
    async (submissionId: string): Promise<WriteOutcome<void>> => {
      const token = signedInToken();
      try {
        await reviseSubmitSubmission(token, submissionId, { id: unsaved.idFor(submissionId) });
        unsaved.saved();
        return { status: 'applied', value: undefined };
      } finally {
        // A refused revise still re-reads: a reviewer may have taken it up.
        await mutate((key) => Array.isArray(key) && key[0] === KEY);
      }
    },
    [mutate, signedInToken, unsaved],
  );
  return { revise };
}
