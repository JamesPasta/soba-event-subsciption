'use client';

import { useEffect } from 'react';
import { useSWRConfig } from 'swr';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { classifyDataError } from '@/src/shared/api/dataError';
import { getWorkspaceRole } from './api';

const roleKey = (workspaceId: string, roleCode: string) =>
  ['workspace-role', workspaceId, roleCode] as const;

/** One role, read to seed the form. Null `roleCode` reads nothing (the create form). */
export function useWorkspaceRole(workspaceId: string, roleCode: string | null) {
  const { data, isLoading, error } = useAuthedSWR(
    roleCode ? roleKey(workspaceId, roleCode) : null,
    (token) => getWorkspaceRole(token, workspaceId, roleCode as string),
  );

  const { mutate } = useSWRConfig();
  useEffect(() => {
    if (!roleCode) return;
    return () => {
      // Clears the record and SWR's request marker, so the next mount reads it again.
      mutate(roleKey(workspaceId, roleCode), undefined).catch(() => undefined);
    };
  }, [workspaceId, roleCode, mutate]);

  return { role: data ?? null, isLoading, error: error ? classifyDataError(error) : null };
}
