'use client';

import { useCallback, useMemo } from 'react';
import { useSWRConfig } from 'swr';
import { deleteSobaSubmission, getSobaSubmissions } from '@/src/shared/api/sobaApi';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult, WriteOutcome } from '@/src/shared/api/dataContracts';
import type { ListQueryArgs } from '@/src/types/list';
import type { SubmissionListItem } from '@/src/types/submissions';
import type { SubmissionReviewStatus } from '@/src/types/submissionReview';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import { designSubmissionKey } from './useDesignSubmission';
import { submissionReviewKey } from './useSubmissionReview';
import { clearJobLists } from '@/src/features/jobs/data/jobReads';

const EMPTY: SubmissionListItem[] = [];

/** Narrows a form's submissions by their review. */
export interface FormSubmissionFilters {
  reviewStatus?: SubmissionReviewStatus;
  assigneeId?: string;
}

/**
 * One page of submissions for one form, read once its tab has been opened. The endpoint requires
 * submission_read, which a designer need not hold, so the read waits to be asked for.
 * `allowStatusUpdates` says whether the form's review shows, once the page is read.
 */
export function useFormSubmissions(
  formId: string | undefined,
  opened: boolean,
  query: ListQueryArgs,
  filters: FormSubmissionFilters = {},
): ListResult<SubmissionListItem> & { allowStatusUpdates: boolean } {
  const locale = useSortLocale();
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    formId && opened
      ? [
          'form-submissions',
          formId,
          query.offset,
          query.limit,
          query.sort,
          query.q ?? '',
          filters.reviewStatus ?? '',
          filters.assigneeId ?? '',
          locale,
        ]
      : null,
    (token) =>
      getSobaSubmissions(token, {
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
        q: query.q,
        locale,
        formId: formId as string,
        reviewStatus: filters.reviewStatus,
        assigneeId: filters.assigneeId,
      }),
    listReadConfig,
  );

  const rows: SubmissionListItem[] = useMemo(
    () => (Array.isArray(data?.items) ? data.items : EMPTY),
    [data],
  );
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
    allowStatusUpdates: data?.allowStatusUpdates === true,
  };
}

/** Delete a submission. */
export function useSubmissionDeleter() {
  const { mutate } = useSWRConfig();
  const remove = useCallback(
    async (token: string, submissionId: string): Promise<WriteOutcome<void>> => {
      await deleteSobaSubmission(token, submissionId);
      await Promise.all([
        mutate((key) => Array.isArray(key) && key[0] === 'form-submissions'),
        // Dropped, not re-read: an open review page would read a 404 before it navigates away.
        mutate(designSubmissionKey(submissionId), undefined, { revalidate: false }),
        mutate(submissionReviewKey(submissionId), undefined, { revalidate: false }),
        // Its jobs stay listed, no longer linked to it.
        clearJobLists(mutate),
      ]);
      return { status: 'applied', value: undefined };
    },
    [mutate],
  );
  return { remove };
}
