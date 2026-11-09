import { describe, it, expect } from 'vitest';
import { needsWorkspaceOnboarding } from '@/src/features/onboarding/workspaceOnboarding';

const readyContext = {
  authenticated: true,
  initializing: false,
  currentUserLoaded: true,
};

function user(capabilities: { canCreateWorkspace: boolean; hasWorkspaces: boolean }) {
  return {
    actor: { id: 'u1', displayLabel: 'User', status: 'active' },
    profile: { displayName: 'User', email: null, preferredUsername: null, idpCode: 'idir' },
    preferences: { defaultWorkspaceId: null },
    capabilities: { ...capabilities, formCreate: 'none' as const, isSobaAdmin: false },
  };
}

describe('workspaceOnboarding', () => {
  it('needsWorkspaceOnboarding when signed in with no workspaces and cannot create', () => {
    expect(
      needsWorkspaceOnboarding({
        ...readyContext,
        currentUser: user({ canCreateWorkspace: false, hasWorkspaces: false }),
      }),
    ).toBe(true);
  });

  it('does not need onboarding when the user can create a workspace', () => {
    expect(
      needsWorkspaceOnboarding({
        ...readyContext,
        currentUser: user({ canCreateWorkspace: true, hasWorkspaces: false }),
      }),
    ).toBe(false);
  });

  it('does not need onboarding when the user already has workspaces', () => {
    expect(
      needsWorkspaceOnboarding({
        ...readyContext,
        currentUser: user({ canCreateWorkspace: false, hasWorkspaces: true }),
      }),
    ).toBe(false);
  });

  it('does not decide before the current user has loaded', () => {
    expect(
      needsWorkspaceOnboarding({ ...readyContext, currentUserLoaded: false, currentUser: null }),
    ).toBe(false);
  });
});
