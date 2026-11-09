'use client';

import { useEffect } from 'react';
import { useSWRConfig } from 'swr';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { CredentialOwner } from '@/src/types/credentials';
import { getCredential } from './api';

const credentialKey = (owner: CredentialOwner, credentialId: string) =>
  ['api-key', owner.kind, owner.id, credentialId] as const;

/** One key's metadata, read to seed the edit form. Null `credentialId` reads nothing. */
export function useCredential(owner: CredentialOwner, credentialId: string | null) {
  const { data, isLoading, error } = useAuthedSWR(
    credentialId ? credentialKey(owner, credentialId) : null,
    (token) => getCredential(token, owner, credentialId as string),
  );

  const { mutate } = useSWRConfig();
  const { kind, id } = owner;
  useEffect(() => {
    if (!credentialId) return;
    return () => {
      // Clears the record and SWR's request marker, so the next mount reads it again.
      mutate(credentialKey({ kind, id }, credentialId), undefined).catch(() => undefined);
    };
  }, [kind, id, credentialId, mutate]);

  return { credential: data ?? null, isLoading, error: error ? classifyDataError(error) : null };
}
