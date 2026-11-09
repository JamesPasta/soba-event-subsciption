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
  ROLES,
  WORKSPACE_ID,
  group,
  groupsPage,
  renderSignedIn,
} from './workspaceGroupsTestKit';

const { mockApi, mockFetchRolesMeta, mockAddNotification } = vi.hoisted(() => ({
  mockApi: {
    listWorkspaceGroups: vi.fn(),
    getWorkspaceGroup: vi.fn(),
    createWorkspaceGroup: vi.fn(),
    renameWorkspaceGroup: vi.fn(),
    setWorkspaceGroupRoles: vi.fn(),
    deleteWorkspaceGroup: vi.fn(),
  },
  mockFetchRolesMeta: vi.fn(),
  mockAddNotification: vi.fn(),
}));

vi.mock('@/src/features/workspaces/data/api', () => mockApi);

vi.mock('@/src/shared/api/sobaApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/shared/api/sobaApi')>()),
  fetchRolesMeta: mockFetchRolesMeta,
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, token: 'token', initializing: false }),
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

const dict = { ...en, locale: 'en' } as unknown as Dictionary;
const t = dict.workspaces.groups;

vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => dict }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/workspace/ws-1',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import WorkspaceGroupTab from '@/src/features/workspaces/ui/WorkspaceGroupTab';

const renderTab = () =>
  renderSignedIn(<WorkspaceGroupTab dict={dict} workspaceId={WORKSPACE_ID} />);

/** The query of the most recent list read. */
const lastListQuery = () => mockApi.listWorkspaceGroups.mock.calls.at(-1)?.[2];

describe('WorkspaceGroupTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/en/workspace/ws-1');
    window.sessionStorage.clear();
    mockApi.listWorkspaceGroups.mockResolvedValue(groupsPage([ADMINS, REVIEWERS]));
    mockFetchRolesMeta.mockResolvedValue(ROLES);
  });

  it('reads the first page by name in the app language and lists each group with its roles', async () => {
    renderTab();

    expect(await screen.findByText('Form administrators')).toBeInTheDocument();
    expect(mockApi.listWorkspaceGroups).toHaveBeenCalledWith('token', WORKSPACE_ID, {
      offset: 0,
      limit: 10,
      sort: 'name:asc',
      // Dropped from the request; see the api test.
      q: '',
      locale: 'en',
    });
    // The dictionary's name wins over the catalog's.
    expect(screen.getByTestId('group-role-grp-reviewers-submission_reviewer')).toHaveTextContent(
      t.roleNames.submission_reviewer,
    );
    // A system group cannot be removed.
    expect(screen.queryByTestId('delete-group-button-grp-admins')).not.toBeInTheDocument();
    expect(screen.getByTestId('delete-group-button-grp-reviewers')).toBeInTheDocument();
  });

  it('asks the server for the other order when the name header is pressed', async () => {
    const user = userEvent.setup();
    const view = renderTab();
    await screen.findByText('Form administrators');

    await user.click(screen.getByTestId('datatable-sort-name'));
    await view.rerender();

    await waitFor(() => expect(lastListQuery()).toMatchObject({ sort: 'name:desc', offset: 0 }));
  });

  it('sends a submitted search to the server, trimmed', async () => {
    const user = userEvent.setup();
    const view = renderTab();
    await screen.findByText('Form administrators');

    await user.click(within(screen.getByTestId('search-ws-groups-text')).getByRole('textbox'));
    await user.paste('  review  ');
    await user.keyboard('{Enter}');
    await view.rerender();

    await waitFor(() => expect(lastListQuery()).toMatchObject({ q: 'review', offset: 0 }));
  });

  it('reads the next page from the server', async () => {
    const user = userEvent.setup();
    mockApi.listWorkspaceGroups.mockResolvedValue(groupsPage([ADMINS, REVIEWERS], { total: 25 }));
    const view = renderTab();
    await screen.findByText('Form administrators');

    await user.click(screen.getByTestId('datatable-next-page-button'));
    await view.rerender();

    await waitFor(() => expect(lastListQuery()).toMatchObject({ offset: 10, limit: 10 }));
  });

  it('says the groups could not load rather than that there are none', async () => {
    mockApi.listWorkspaceGroups.mockRejectedValue(new ApiError('Request failed (500)', 500));
    renderTab();

    expect(await screen.findByTestId('datatable-error')).toHaveTextContent(t.loadError);
    expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
  });

  it('shows a group without roles as having none', async () => {
    mockApi.listWorkspaceGroups.mockResolvedValue(groupsPage([group({ id: 'grp-empty' })]));
    renderTab();

    expect(await screen.findByText(t.noRolesSelected)).toBeInTheDocument();
  });

  it('removes a group once confirmed, then re-reads the list', async () => {
    const user = userEvent.setup();
    mockApi.deleteWorkspaceGroup.mockResolvedValue(undefined);
    renderTab();
    await screen.findByText('Form Reviewers');
    const readsBefore = mockApi.listWorkspaceGroups.mock.calls.length;

    await user.click(screen.getByTestId('delete-group-button-grp-reviewers'));
    await user.click(screen.getByRole('button', { name: t.deleteGroup }));

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', text: t.deleteSuccess }),
      ),
    );
    expect(mockApi.deleteWorkspaceGroup).toHaveBeenCalledWith('token', WORKSPACE_ID, REVIEWERS.id);
    expect(mockApi.listWorkspaceGroups.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it('closes the edit form of a group once that group is removed', async () => {
    const user = userEvent.setup();
    mockApi.getWorkspaceGroup.mockResolvedValue(REVIEWERS);
    mockApi.deleteWorkspaceGroup.mockResolvedValue(undefined);
    renderTab();
    await screen.findByText('Form Reviewers');

    await user.click(screen.getByTestId('edit-group-button-grp-reviewers'));
    await screen.findByDisplayValue(REVIEWERS.name);
    await user.click(screen.getByTestId('delete-group-button-grp-reviewers'));
    await user.click(screen.getByRole('button', { name: t.deleteGroup }));

    await waitFor(() =>
      expect(screen.queryByTestId('workspace-group-edit-form')).not.toBeInTheDocument(),
    );
  });

  it('leaves an open create form alone when another group is removed', async () => {
    const user = userEvent.setup();
    mockApi.deleteWorkspaceGroup.mockResolvedValue(undefined);
    renderTab();
    await screen.findByText('Form Reviewers');

    await user.click(screen.getByTestId('create-ws-group-button'));
    await user.click(await screen.findByRole('textbox', { name: new RegExp(t.name) }));
    await user.paste('Approvers');
    await user.click(screen.getByTestId('delete-group-button-grp-reviewers'));
    await user.click(screen.getByRole('button', { name: t.deleteGroup }));

    await waitFor(() => expect(mockApi.deleteWorkspaceGroup).toHaveBeenCalled());
    expect(screen.getByTestId('workspace-group-create-form')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Approvers')).toBeInTheDocument();
  });

  it('reports a refused removal as a failure', async () => {
    const user = userEvent.setup();
    mockApi.deleteWorkspaceGroup.mockRejectedValue(new ApiError('Request failed (403)', 403));
    renderTab();
    await screen.findByText('Form Reviewers');

    await user.click(screen.getByTestId('delete-group-button-grp-reviewers'));
    await user.click(screen.getByRole('button', { name: t.deleteGroup }));

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: t.deleteError }),
      ),
    );
    expect(mockAddNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('opens the create form under the table and closes it on cancel', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Form administrators');

    await user.click(screen.getByTestId('create-ws-group-button'));
    expect(await screen.findByTestId('group-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-group-create-form')).toBeInTheDocument();

    await user.click(screen.getByTestId('group-cancel-button'));
    expect(screen.queryByTestId('workspace-group-create-form')).not.toBeInTheDocument();
  });

  it.each([
    ['Add Group', 'create-ws-group-button', 'workspace-group-create-form'],
    ['Edit', 'edit-group-button-grp-reviewers', 'workspace-group-edit-form'],
  ])('brings the form into view and focus when %s is pressed', async (_label, button, form) => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    // jsdom has no layout, so the method is not there to spy on.
    Element.prototype.scrollIntoView = scrollIntoView;
    mockApi.getWorkspaceGroup.mockResolvedValue(REVIEWERS);
    renderTab();
    await screen.findByText('Form Reviewers');

    await user.click(screen.getByTestId(button));

    const opened = await screen.findByTestId(form);
    expect(opened).toHaveFocus();
    expect(opened).toHaveAccessibleName(
      button === 'create-ws-group-button' ? t.addGroup : t.editGroup,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(opened);
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('opens the edit form on the group read by its id, not the row', async () => {
    const user = userEvent.setup();
    mockApi.getWorkspaceGroup.mockResolvedValue({ ...REVIEWERS, name: 'Reviewers (renamed)' });
    renderTab();
    await screen.findByText('Form Reviewers');

    await user.click(screen.getByTestId('edit-group-button-grp-reviewers'));

    expect(await screen.findByDisplayValue('Reviewers (renamed)')).toBeInTheDocument();
    expect(mockApi.getWorkspaceGroup).toHaveBeenCalledWith(
      'token',
      WORKSPACE_ID,
      REVIEWERS.id,
      'en',
    );
  });
});
