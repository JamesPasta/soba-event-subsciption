import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import {
  ADMINS,
  REVIEWERS,
  WORKSPACE_ID,
  groupsPage,
  renderSignedIn,
} from './workspaceGroupsTestKit';
import { OWNER, REVIEWER, SELF, SELF_USER_ID, accessPage, member } from './workspaceAccessTestKit';

const { mockGroupsApi, mockAccessApi, mockAddNotification, search, session } = vi.hoisted(() => ({
  mockGroupsApi: { listWorkspaceGroups: vi.fn(), renameWorkspaceGroup: vi.fn() },
  mockAccessApi: {
    listWorkspaceAccess: vi.fn(),
    getWorkspaceAccess: vi.fn(),
    addWorkspaceAccess: vi.fn(),
    setWorkspaceAccessGroups: vi.fn(),
    removeWorkspaceAccess: vi.fn(),
  },
  mockAddNotification: vi.fn(),
  search: { allowed: true as boolean | null },
  /** The signed-in user's id as /me reports it; undefined until it loads. */
  session: { actorId: undefined as string | undefined },
}));

vi.mock('@/src/features/workspaces/data/api', () => mockGroupsApi);
vi.mock('@/src/features/workspaces/data/accessApi', () => mockAccessApi);

vi.mock('@/src/features/user-search/data/useUserSearch', () => ({
  useUserSearchAllowed: () => search.allowed,
  useUserFromSearchWriter: () => ({ create: vi.fn() }),
}));
vi.mock('@/src/features/user-search/ui/UserSearchPicker', () => ({
  UserSearchPicker: () => <div data-testid="picker" />,
}));

vi.mock('@/src/shared/api/useCurrentUser', () => ({
  useCurrentUser: () => ({ data: session.actorId ? { actor: { id: session.actorId } } : null }),
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, token: 'token', initializing: false }),
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

const dict = { ...en, locale: 'en' } as unknown as Dictionary;
const t = dict.workspaces.access;

vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => dict }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/workspace/ws-1',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import WorkspaceAccessTab from '@/src/features/workspaces/ui/WorkspaceAccessTab';
import { useWorkspaceGroupsWriter } from '@/src/features/workspaces/data/useWorkspaceGroupsWriter';

const renderTab = () =>
  renderSignedIn(<WorkspaceAccessTab dict={dict} workspaceId={WORKSPACE_ID} />);

/** Renames a group as the Groups tab does, beside the Access tab and sharing its cache. */
function RenameGroup() {
  const writer = useWorkspaceGroupsWriter(WORKSPACE_ID);
  return (
    <button
      type="button"
      onClick={() =>
        void writer.update('token', REVIEWERS, { name: 'Senior', roleCodes: REVIEWERS.roles })
      }
    >
      rename
    </button>
  );
}

/** Opens the list at a URL that names its Show filter. */
const visitWithInclude = (include: string) =>
  window.history.replaceState(null, '', `/en/workspace/ws-1?workspaceAccess.include=${include}`);

const chooseShow = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.click(within(screen.getByTestId('ws-access-include-filter')).getByRole('button'));
  await user.click(await screen.findByRole('option', { name: label }));
};

/** The query of the most recent list read. */
const lastListQuery = () => mockAccessApi.listWorkspaceAccess.mock.calls.at(-1)?.[2];

describe('WorkspaceAccessTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.allowed = true;
    session.actorId = SELF_USER_ID;
    window.history.replaceState(null, '', '/en/workspace/ws-1');
    window.sessionStorage.clear();
    mockAccessApi.listWorkspaceAccess.mockResolvedValue(accessPage([OWNER, SELF, REVIEWER]));
    mockGroupsApi.listWorkspaceGroups.mockResolvedValue(groupsPage([ADMINS, REVIEWERS]));
  });

  it('reads people in a group by name and lists each with their email, role and groups', async () => {
    renderTab();

    expect(await screen.findByText('Rita Reviewer')).toBeInTheDocument();
    expect(mockAccessApi.listWorkspaceAccess).toHaveBeenCalledWith('token', WORKSPACE_ID, {
      offset: 0,
      limit: 10,
      sort: 'displayLabel:asc',
      q: '',
      include: 'grouped',
      locale: 'en',
    });
    expect(screen.getByText('rita@example.gov.bc.ca')).toBeInTheDocument();
    expect(screen.getByTestId('member-role-m-owner')).toHaveTextContent('Owner');
    expect(screen.getByTestId(`member-group-m-reviewer-${REVIEWERS.id}`)).toHaveTextContent(
      REVIEWERS.name,
    );
  });

  it('offers no Remove for the owner or for the signed-in user', async () => {
    renderTab();
    await screen.findByText('Rita Reviewer');

    expect(screen.queryByTestId('remove-member-button-m-owner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('remove-member-button-m-self')).not.toBeInTheDocument();
    expect(screen.getByTestId('remove-member-button-m-reviewer')).toBeInTheDocument();
    expect(screen.getByTestId('edit-member-button-m-owner')).toBeInTheDocument();
  });

  it('asks for every workspace member when the filter says so, and shows one with no groups', async () => {
    const user = userEvent.setup();
    const view = renderTab();
    await screen.findByText('Rita Reviewer');
    mockAccessApi.listWorkspaceAccess.mockResolvedValue(
      accessPage([member({ membershipId: 'm-new', displayLabel: 'Nia New' })]),
    );

    await chooseShow(user, t.showAll);
    await view.rerender();

    await waitFor(() => expect(lastListQuery()).toMatchObject({ include: 'all', offset: 0 }));
    expect(await screen.findByText('Nia New')).toBeInTheDocument();
    expect(screen.getByText(t.noGroups)).toBeInTheDocument();
    expect(window.location.search).toBe('?workspaceAccess.include=all');
  });

  it('opens on every workspace member when the URL says so', async () => {
    visitWithInclude('all');
    renderTab();

    await waitFor(() => expect(lastListQuery()).toMatchObject({ include: 'all' }));
    expect(
      within(screen.getByTestId('ws-access-include-filter')).getByRole('button'),
    ).toHaveTextContent(t.showAll);
  });

  it('drops the filter from the URL when going back to people in a group', async () => {
    const user = userEvent.setup();
    visitWithInclude('all');
    const view = renderTab();
    await screen.findByText('Rita Reviewer');

    await chooseShow(user, t.showGrouped);
    await view.rerender();

    await waitFor(() => expect(lastListQuery()).toMatchObject({ include: 'grouped' }));
    expect(window.location.search).toBe('');
  });

  it('drops a filter value it does not offer and reads people in a group', async () => {
    visitWithInclude('everyone');
    const view = renderTab();
    await screen.findByText('Rita Reviewer');
    await view.rerender();

    await waitFor(() => expect(window.location.search).toBe(''));
    expect(
      mockAccessApi.listWorkspaceAccess.mock.calls.every(([, , q]) => q.include === 'grouped'),
    ).toBe(true);
  });

  it('says no one is in a group, rather than that the workspace is empty', async () => {
    mockAccessApi.listWorkspaceAccess.mockResolvedValue(accessPage([]));
    renderTab();

    expect(await screen.findByText(t.emptyGrouped)).toBeInTheDocument();
  });

  it.each([
    ['people in a group, pointing at everyone else', '', t.noMatchesGrouped],
    ['every workspace member', 'all', t.noMatches],
  ])('says a search of %s matched no one', async (_view, include, message) => {
    const user = userEvent.setup();
    if (include) visitWithInclude(include);
    const view = renderTab();
    await screen.findByText('Rita Reviewer');
    mockAccessApi.listWorkspaceAccess.mockResolvedValue(accessPage([]));

    await user.click(within(screen.getByTestId('search-ws-access-text')).getByRole('textbox'));
    await user.paste('nobody');
    await user.keyboard('{Enter}');
    await view.rerender();

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it.each([
    ['an admin, naming the role they lose', 'admin', 'Admin'],
    ['a viewer, with no role to name', 'viewer', null],
  ])('asks before removing %s', async (_label, role, roleName) => {
    const user = userEvent.setup();
    mockAccessApi.listWorkspaceAccess.mockResolvedValue(accessPage([{ ...REVIEWER, role }]));
    renderTab();
    await screen.findByText('Rita Reviewer');

    await user.click(screen.getByTestId('remove-member-button-m-reviewer'));

    const expected = roleName
      ? t.removeConfirmRoleMessage.replace('{name}', 'Rita Reviewer').replace('{role}', roleName)
      : t.removeConfirmMessage.replace('{name}', 'Rita Reviewer');
    expect(await screen.findByTestId('confirm-modal-message')).toHaveTextContent(expected);
  });

  it('offers no Remove until it knows who is signed in', async () => {
    session.actorId = undefined;
    renderTab();
    await screen.findByText('Rita Reviewer');

    expect(screen.queryByTestId('remove-member-button-m-reviewer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('remove-member-button-m-self')).not.toBeInTheDocument();
  });

  it('reads the people again when a group is renamed on the Groups tab', async () => {
    const user = userEvent.setup();
    mockGroupsApi.renameWorkspaceGroup.mockResolvedValue(REVIEWERS);
    renderSignedIn(
      <>
        <WorkspaceAccessTab dict={dict} workspaceId={WORKSPACE_ID} />
        <RenameGroup />
      </>,
    );
    await screen.findByText('Rita Reviewer');
    const readsBefore = mockAccessApi.listWorkspaceAccess.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'rename' }));

    await waitFor(() =>
      expect(mockAccessApi.listWorkspaceAccess.mock.calls.length).toBeGreaterThan(readsBefore),
    );
  });

  it('sends a submitted search to the server, trimmed', async () => {
    const user = userEvent.setup();
    const view = renderTab();
    await screen.findByText('Rita Reviewer');

    await user.click(within(screen.getByTestId('search-ws-access-text')).getByRole('textbox'));
    await user.paste('  rita  ');
    await user.keyboard('{Enter}');
    await view.rerender();

    await waitFor(() => expect(lastListQuery()).toMatchObject({ q: 'rita', offset: 0 }));
  });

  it('says the people could not load rather than that there are none', async () => {
    mockAccessApi.listWorkspaceAccess.mockRejectedValue(new ApiError('Request failed (500)', 500));
    renderTab();

    expect(await screen.findByTestId('datatable-error')).toHaveTextContent(t.loadError);
    expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
  });

  it('offers Add only where user search is allowed', async () => {
    search.allowed = false;
    renderTab();
    await screen.findByText('Rita Reviewer');

    expect(screen.queryByTestId('add-ws-member-button')).not.toBeInTheDocument();
  });

  it('opens the add form under the table, with the list still shown', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Rita Reviewer');

    await user.click(screen.getByTestId('add-ws-member-button'));

    expect(await screen.findByTestId('workspace-member-add-form')).toBeInTheDocument();
    expect(screen.getByTestId('picker')).toBeInTheDocument();
    expect(screen.getByText('Rita Reviewer')).toBeInTheDocument();
  });

  it('removes a person once confirmed, then re-reads the list', async () => {
    const user = userEvent.setup();
    mockAccessApi.removeWorkspaceAccess.mockResolvedValue(undefined);
    renderTab();
    await screen.findByText('Rita Reviewer');
    const readsBefore = mockAccessApi.listWorkspaceAccess.mock.calls.length;

    await user.click(screen.getByTestId('remove-member-button-m-reviewer'));
    await user.click(screen.getByRole('button', { name: t.removeMember }));

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', text: t.removeSuccess }),
      ),
    );
    expect(mockAccessApi.removeWorkspaceAccess).toHaveBeenCalledWith(
      'token',
      WORKSPACE_ID,
      REVIEWER.membershipId,
    );
    expect(mockAccessApi.listWorkspaceAccess.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it('closes the edit form of a person once that person is removed', async () => {
    const user = userEvent.setup();
    mockAccessApi.getWorkspaceAccess.mockResolvedValue(REVIEWER);
    mockAccessApi.removeWorkspaceAccess.mockResolvedValue(undefined);
    renderTab();
    await screen.findByText('Rita Reviewer');

    await user.click(screen.getByTestId('edit-member-button-m-reviewer'));
    await screen.findByTestId('member-identity');
    await user.click(screen.getByTestId('remove-member-button-m-reviewer'));
    await user.click(screen.getByRole('button', { name: t.removeMember }));

    await waitFor(() =>
      expect(screen.queryByTestId('workspace-member-edit-form')).not.toBeInTheDocument(),
    );
  });

  it('says why a removal was refused', async () => {
    const user = userEvent.setup();
    mockAccessApi.removeWorkspaceAccess.mockRejectedValue(
      new ApiError('Form administrators must keep at least one member', 409, 'last_form_admin'),
    );
    renderTab();
    await screen.findByText('Rita Reviewer');

    await user.click(screen.getByTestId('remove-member-button-m-reviewer'));
    await user.click(screen.getByRole('button', { name: t.removeMember }));

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: dict.apiErrors.last_form_admin }),
      ),
    );
  });
});
