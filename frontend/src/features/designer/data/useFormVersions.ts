'use client';

import { useCallback, useMemo } from 'react';
import { getSobaFormVersionPage } from '@/src/shared/api/sobaApi';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { ListResult } from '@/src/shared/api/dataContracts';
import type { ListQueryArgs } from '@/src/types/list';
import type { SobaFormVersionListItem } from '@/src/types/forms';

const EMPTY: SobaFormVersionListItem[] = [];

/** The key every read of a form's versions shares, so one refresh reaches all of them. */
export const versionsKey = (formId: string) => ['design-form-versions', formId];

/** One page of a form's versions, for the history table. */
export function useFormVersionPage(
  formId: string | undefined,
  query: ListQueryArgs,
): ListResult<SobaFormVersionListItem> {
  const { data, isLoading, isValidating, error, mutate } = useAuthedSWR(
    formId ? [...versionsKey(formId), query.offset, query.limit, query.sort] : null,
    (token) =>
      getSobaFormVersionPage(token, {
        formId: formId as string,
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
      }),
    listReadConfig,
  );

  const rows: SobaFormVersionListItem[] = useMemo(
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
  };
}
