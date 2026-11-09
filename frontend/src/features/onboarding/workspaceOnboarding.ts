import type { CurrentUserResponse } from '@/src/types/user';

type WorkspaceOnboardingInput = {
  authenticated: boolean;
  initializing: boolean;
  currentUserLoaded: boolean;
  currentUser: CurrentUserResponse | null;
};

/** Signed-in user with no workspace access and no path to create a workspace. */
export function needsWorkspaceOnboarding({
  authenticated,
  initializing,
  currentUserLoaded,
  currentUser,
}: WorkspaceOnboardingInput): boolean {
  if (!authenticated || initializing || !currentUserLoaded) return false;
  const capabilities = currentUser?.capabilities;
  if (capabilities?.hasWorkspaces === true) return false;
  return capabilities?.canCreateWorkspace !== true;
}
