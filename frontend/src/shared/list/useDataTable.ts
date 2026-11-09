'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { ListResult } from '@/src/shared/api/dataContracts';
import { messageForDataError } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults, useDataErrorNotice } from '@/src/shared/api/useDataErrorNotice';
import { PAGE_SIZE_OPTIONS, type ListQueryControls } from './useListQuery';

/** The list-driven props of DataTable; a screen adds its own columns, caption and keyExtractor. */
export interface DataTableProps<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  totalItems: number | undefined;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions: number[];
  sort: string;
  onSortChange: (sort: string) => void;
}

export interface DataTableBinding<T> {
  table: DataTableProps<T>;
  refresh: () => Promise<void>;
  isRefreshing: boolean;
}

/**
 * Binds a list's URL query (from useListQuery) and its resource result to DataTable. A failed
 * initial load fills the table; a failed reload with rows still on screen is a toast instead.
 * `failedMessage` is the resource's own "could not load" copy; session and access failures fall
 * back to the shared strings. The caller passes the query and result so a resource hook that needs
 * extra arguments is still called directly by the screen.
 */
export function useDataTable<T>(
  query: ListQueryControls,
  result: ListResult<T>,
  failedMessage: string,
): DataTableBinding<T> {
  const { total, rows, error, isLoading, isRefreshing, refresh } = result;
  const { page, pageSize, setPage, setPageSize, sort, setSort } = query;

  // Deleting the last row on the last page would otherwise leave the table on an empty page.
  const lastPage = total === undefined ? page : Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (total !== undefined && page > lastPage) setPage(lastPage);
  }, [total, page, lastPage, setPage]);

  const authDefaults = useAuthErrorDefaults();
  const notify = useDataErrorNotice();
  const hasRows = rows.length > 0;

  // Toast a failed reload once per distinct failure; the raw cause is stable while the error stands.
  const notifiedRef = useRef<unknown>(null);
  useEffect(() => {
    if (error && hasRows && error.cause !== notifiedRef.current) {
      notifiedRef.current = error.cause;
      notify(error.cause, { failed: failedMessage });
    }
    if (!error) notifiedRef.current = null;
  }, [error, hasRows, notify, failedMessage]);

  const inlineError =
    error && !hasRows
      ? messageForDataError(error, { ...authDefaults, failed: failedMessage })
      : null;

  const table = useMemo<DataTableProps<T>>(
    () => ({
      data: rows,
      loading: isLoading,
      error: inlineError,
      totalItems: total,
      pageSize,
      currentPage: page,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
      pageSizeOptions: PAGE_SIZE_OPTIONS,
      sort,
      onSortChange: setSort,
    }),
    [rows, isLoading, inlineError, total, pageSize, page, setPage, setPageSize, sort, setSort],
  );

  return { table, refresh, isRefreshing };
}
