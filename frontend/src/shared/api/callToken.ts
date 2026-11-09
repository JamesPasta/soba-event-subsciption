'use client';

import { useCallback } from 'react';
import { useStore } from 'react-redux';
import type { RootState } from '@/lib/store';
import { SessionExpiredError } from './sobaFetch';

/**
 * Reads the token for a call when the call is made. A call for a signed-in session that no longer
 * holds a token throws SessionExpiredError and is never sent anonymously; a signed-out call sends no
 * token.
 */
export function useCallToken() {
  const store = useStore<RootState>();
  const isSignedIn = useCallback(() => !!store.getState().keycloak.authenticated, [store]);
  const signedInToken = useCallback((): string => {
    const { token } = store.getState().keycloak;
    if (!token) throw new SessionExpiredError();
    return token;
  }, [store]);
  const tokenFor = useCallback(
    (signedIn: boolean): string | undefined => (signedIn ? signedInToken() : undefined),
    [signedInToken],
  );
  return { isSignedIn, signedInToken, tokenFor };
}
