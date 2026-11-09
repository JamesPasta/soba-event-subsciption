import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockUseKeycloak, mockUseCurrentUser, mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockUseKeycloak: vi.fn(),
  mockUseCurrentUser: vi.fn(),
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => mockUseKeycloak(),
}));

vi.mock('@/src/shared/api/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    locale: 'en',
    general: { notAuthenticated: 'Not authed', loading: 'Loading…' },
    admin: {
      forbidden: 'You do not have the platform administrator role required for this section.',
      admins: { heading: 'Platform administrators' },
      featureScopes: { heading: 'Feature access' },
      audits: { heading: 'Document generation' },
    },
    jobs: { heading: 'Jobs' },
  }),
}));

vi.mock('@/src/features/admin/ui/SobaAdminsPanel', () => ({
  SobaAdminsPanel: () => <div data-testid="admins-panel" />,
}));
vi.mock('@/src/features/admin/ui/FeatureScopeListPanel', () => ({
  FeatureScopeListPanel: () => <div data-testid="feature-scope-panel" />,
}));
vi.mock('@/src/features/admin/ui/DocumentGenerationAuditsPanel', () => ({
  DocumentGenerationAuditsPanel: () => <div data-testid="audits-panel" />,
}));
vi.mock('@/src/features/admin/ui/JobsPanel', () => ({
  JobsPanel: () => <div data-testid="jobs-panel" />,
}));

import { AdminDashboard } from '@/src/features/admin/ui/AdminDashboard';

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<unknown>('next/navigation');
  return {
    ...(actual as Record<string, unknown>),
    useRouter: () => ({ push: mockPush }),
    usePathname: () => '/en/admin',
    useSearchParams: () => new URLSearchParams(''),
  };
});

const renderDashboard = async (props?: React.ComponentProps<typeof AdminDashboard>) => {
  await act(async () => {
    render(<AdminDashboard {...props} />);
  });
};

const signedIn = () => {
  mockUseKeycloak.mockReturnValue({ authenticated: true, initializing: false, token: 'token' });
};

const currentUser = (isSobaAdmin: boolean) => {
  mockUseCurrentUser.mockReturnValue({ data: { capabilities: { isSobaAdmin } }, loaded: true });
};

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCurrentUser.mockReturnValue({ data: null, loaded: true });
  });

  it('prompts to sign in when unauthenticated', async () => {
    mockUseKeycloak.mockReturnValue({ authenticated: false, initializing: false });

    await renderDashboard();

    expect(screen.getByText('Not authed')).toBeInTheDocument();
  });

  it('refuses access to a signed-in non-admin', async () => {
    signedIn();
    currentUser(false);

    await renderDashboard();

    expect(
      screen.getByText(
        'You do not have the platform administrator role required for this section.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('admins-panel')).not.toBeInTheDocument();
  });

  // The answer lives in /me, so until it lands "not an admin" is unknown, not false.
  it('waits for the current user rather than refusing access', async () => {
    signedIn();
    mockUseCurrentUser.mockReturnValue({ data: null, loaded: false });

    await renderDashboard();

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    expect(
      screen.queryByText(
        'You do not have the platform administrator role required for this section.',
      ),
    ).not.toBeInTheDocument();
  });

  it('admits an admin the token says nothing about', async () => {
    signedIn();
    currentUser(true);

    await renderDashboard();

    expect(screen.getByTestId('admins-panel')).toBeInTheDocument();
    // The page heading belongs to PageLayout.
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Feature access' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Document generation' })).not.toBeInTheDocument();
  });

  it('renders the document generation audit tab for a soba_admin when the feature is enabled', async () => {
    signedIn();
    currentUser(true);

    await renderDashboard({ documentGenerationEnabled: true });

    expect(screen.getByRole('tab', { name: 'Document generation' })).toBeInTheDocument();
  });

  it('opens on the Jobs tab when the jobs page asks for it', async () => {
    signedIn();
    currentUser(true);

    await renderDashboard({ defaultActiveTab: 'jobs' });

    expect(screen.getByRole('tab', { name: 'Jobs' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('jobs-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('admins-panel')).not.toBeInTheDocument();
  });

  // Each tab has its own page, so browser Back from a job returns to the Jobs tab.
  it.each([
    ['Jobs', '/en/admin/jobs'],
    ['Feature access', '/en/admin/feature-scopes'],
    ['Document generation', '/en/admin/document-generation'],
  ])('opens the %s tab at its own address', async (name, path) => {
    signedIn();
    currentUser(true);
    await renderDashboard({ documentGenerationEnabled: true });

    await userEvent.click(screen.getByRole('tab', { name }));

    expect(mockPush).toHaveBeenCalledWith(`${path}?from=nav`);
    expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the first tab at the document generation address when that feature is off', async () => {
    signedIn();
    currentUser(true);

    await renderDashboard({ defaultActiveTab: 'audits' });

    expect(screen.getByTestId('admins-panel')).toBeInTheDocument();
  });
});
