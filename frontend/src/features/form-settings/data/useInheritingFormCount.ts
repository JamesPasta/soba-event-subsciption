import { useId } from 'react';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { getWorkspaceInheritingForms } from './api';

export interface InheritingFormCount {
  /** Null until the read answers. */
  count: number | null;
  loading: boolean;
  failed: boolean;
}

/**
 * How many live forms use a group's workspace values. Forms change between reads, so each `read`
 * number of each mounted caller is a read of its own and never shows an earlier read's count. Null
 * reads nothing.
 */
export function useInheritingFormCount(
  key: string,
  workspaceId: string | null,
  read: number | null,
): InheritingFormCount {
  const readerId = useId();
  const active = read !== null && !!workspaceId;
  const { data, error } = useAuthedSWR<{ count: number }>(
    active ? ['workspace-settings', key, workspaceId, 'inheriting-forms', readerId, read] : null,
    (token) => getWorkspaceInheritingForms(token, workspaceId as string, key),
  );
  return {
    count: data?.count ?? null,
    loading: active && !data && !error,
    failed: active && !!error,
  };
}
