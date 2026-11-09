import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FaHouse, FaRegFileLines } from 'react-icons/fa6';
import styles from '@/app/ui/SideNav.module.css';

const { session, currentUser, nav } = vi.hoisted(() => ({
  session: { authenticated: false, initializing: false },
  currentUser: {
    data: null as { capabilities: { isSobaAdmin: boolean } } | null,
    loaded: true,
  },
  nav: { pathname: '/en/forms' },
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => session,
}));

vi.mock('@/src/shared/api/useCurrentUser', () => ({
  useCurrentUser: () => currentUser,
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    locale: 'en',
    general: {
      forms: 'Forms',
      myForms: 'My Forms',
      mySubmissions: 'My Submissions',
      feedback: 'Feedback',
      help: 'Help',
    },
    header: { workspaces: 'Workspaces' },
    admin: { heading: 'Administration' },
    sideNav: { toggleSidebar: 'Toggle sidebar' },
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}));

import { SideNav } from '@/app/ui/SideNav';

type Modes = { designMode: boolean; submitMode: boolean };

const NO_MODES: Modes = { designMode: false, submitMode: false };
const DESIGN_ONLY: Modes = { designMode: true, submitMode: false };
const SUBMIT_ONLY: Modes = { designMode: false, submitMode: true };
const COMBINED: Modes = { designMode: true, submitMode: true };

async function renderNav(modes: Modes = NO_MODES) {
  await act(async () => {
    render(<SideNav {...modes} />);
  });
}

function signIn(isSobaAdmin: boolean) {
  session.authenticated = true;
  currentUser.data = { capabilities: { isSobaAdmin } };
}

const navTestIds = () => screen.getAllByRole('link').map((link) => link.dataset.testid);

const iconPath = (element: Element) => element.querySelector('svg path')?.getAttribute('d');

function pathOf(icon: React.ReactElement) {
  const { container, unmount } = render(icon);
  const path = iconPath(container);
  unmount();
  return path;
}

describe('SideNav', () => {
  beforeEach(() => {
    session.authenticated = false;
    currentUser.data = null;
    nav.pathname = '/en/forms';
  });

  it('links to feedback and help with every feature off', async () => {
    await renderNav();

    expect(navTestIds()).toEqual(['feedback-nav', 'help-nav']);
  });

  it('shows a signed-out visitor only feedback and help', async () => {
    await renderNav(COMBINED);

    expect(navTestIds()).toEqual(['feedback-nav', 'help-nav']);
  });

  it('links design mode to forms and workspaces', async () => {
    signIn(false);

    await renderNav(DESIGN_ONLY);

    expect(navTestIds()).toEqual(['forms-nav', 'workspaces-nav', 'feedback-nav', 'help-nav']);
  });

  it('links submit mode to my forms and my submissions', async () => {
    signIn(false);

    await renderNav(SUBMIT_ONLY);

    expect(navTestIds()).toEqual([
      'my-forms-nav',
      'my-submissions-nav',
      'feedback-nav',
      'help-nav',
    ]);
  });

  it('orders design mode, submit mode, then administration when both modes are on', async () => {
    signIn(true);

    await renderNav(COMBINED);

    expect(navTestIds()).toEqual([
      'forms-nav',
      'workspaces-nav',
      'my-forms-nav',
      'my-submissions-nav',
      'admin-nav',
      'feedback-nav',
      'help-nav',
    ]);
  });

  it('gives my forms the house icon when only submit mode is on', async () => {
    const house = pathOf(<FaHouse />);
    signIn(false);

    await renderNav(SUBMIT_ONLY);

    expect(iconPath(screen.getByTestId('my-forms-nav'))).toBe(house);
  });

  it('gives forms the house icon when both modes are on', async () => {
    const house = pathOf(<FaHouse />);
    const file = pathOf(<FaRegFileLines />);
    signIn(false);

    await renderNav(COMBINED);

    expect(iconPath(screen.getByTestId('forms-nav'))).toBe(house);
    expect(iconPath(screen.getByTestId('my-forms-nav'))).toBe(file);
  });

  it('marks my submissions active on its routes', async () => {
    nav.pathname = '/en/my-submissions/abc';
    signIn(false);

    await renderNav(SUBMIT_ONLY);

    expect(screen.getByTestId('my-submissions-nav')).toHaveClass(styles.navActive);
    expect(screen.getByTestId('my-forms-nav')).not.toHaveClass(styles.navActive);
  });

  it('links an admin to administration', async () => {
    signIn(true);

    await renderNav();

    expect(navTestIds()).toEqual(['admin-nav', 'feedback-nav', 'help-nav']);
  });

  it('hides administration from a signed-in user who is not an admin', async () => {
    signIn(false);

    await renderNav();

    expect(screen.queryByTestId('admin-nav')).not.toBeInTheDocument();
  });
});
