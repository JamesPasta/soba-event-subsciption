'use client';

import { useMemo } from 'react';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useCurrentUser } from '@/src/shared/api/useCurrentUser';
import { needsWorkspaceOnboarding } from '@/src/features/onboarding/workspaceOnboarding';
import type { AppSessionSnapshot } from './appRoutePolicy';

export function useAppSession(): AppSessionSnapshot {
  const { authenticated, initializing, initStarted } = useKeycloak();

  const {
    data: currentUser,
    loaded: currentUserLoaded,
    error: currentUserError,
  } = useCurrentUser();

  return useMemo(() => {
    const sessionReady = authenticated
      ? !initializing && currentUserLoaded && !currentUserError
      : !initializing;

    const sessionFailed = authenticated && !!currentUserError;

    const needsOnboarding = needsWorkspaceOnboarding({
      authenticated,
      initializing,
      currentUserLoaded,
      currentUser,
    });

    return {
      authenticated,
      initializing,
      initStarted,
      sessionReady,
      // Derived, not latched: SWR keeps the last data on error, so a failed reload does not move
      // it, and it goes false when the key goes empty, which is what the sign-out cache clear does.
      sessionLoadedOnce: currentUserLoaded,
      sessionFailed,
      needsOnboarding,
      canCreateWorkspace: currentUser?.capabilities?.canCreateWorkspace === true,
      hasWorkspaces: currentUser?.capabilities?.hasWorkspaces === true,
    };
  }, [authenticated, initializing, initStarted, currentUserLoaded, currentUserError, currentUser]);
}
