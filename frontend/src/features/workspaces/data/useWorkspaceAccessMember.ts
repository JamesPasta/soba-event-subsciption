'use client';

import { useEffect } from 'react';
import { useSWRConfig } from 'swr';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { classifyDataError } from '@/src/shared/api/dataError';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import { getWorkspaceAccess } from './accessApi';

const memberKey = (workspaceId: string, membershipId: string, locale: string) =>
  ['workspace-access-member', workspaceId, membershipId, locale] as const;

/** One member, read to seed the edit form. Null `membershipId` reads nothing (the add form). */
export function useWorkspaceAccessMember(workspaceId: string, membershipId: string | null) {
  const locale = useSortLocale();
  const { data, isLoading, error } = useAuthedSWR(
    membershipId ? memberKey(workspaceId, membershipId, locale) : null,
    (token) => getWorkspaceAccess(token, workspaceId, membershipId as string, locale),
  );

  const { mutate } = useSWRConfig();
  useEffect(() => {
    if (!membershipId) return;
    return () => {
      // Clears the record and SWR's request marker, so the next mount reads it again.
      mutate(memberKey(workspaceId, membershipId, locale), undefined).catch(() => undefined);
    };
  }, [workspaceId, membershipId, locale, mutate]);

  return { member: data ?? null, isLoading, error: error ? classifyDataError(error) : null };
}
