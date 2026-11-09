'use client';

import { useMemo } from 'react';
import { PUBLIC_PROVIDER_CODE, type AccessCaller } from '@soba/lib';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useCurrentUser } from './useCurrentUser';

/**
 * Who is asking, for the @soba/lib rules: the public caller when signed out, the provider from /me
 * when signed in. Pending until Keycloak answers and, signed in, until /me loads. A /me that fails
 * gives no provider, which no audience admits.
 */
export function useAccessCaller(): { caller: AccessCaller; pending: boolean } {
  const { authenticated, initializing, initStarted } = useKeycloak();
  const currentUser = useCurrentUser();
  const idpCode = authenticated
    ? (currentUser.data?.profile.idpCode ?? null)
    : PUBLIC_PROVIDER_CODE;
  const pending =
    !initStarted || initializing || (authenticated && !currentUser.loaded && !currentUser.hasError);
  const caller = useMemo(() => ({ idpCode }), [idpCode]);
  return { caller, pending };
}
