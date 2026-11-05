import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import en from '@/dictionaries/en.json';
import fr from '@/dictionaries/fr.json';
import type { Dictionary } from '@/src/types/dictionary';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import type { WorkspaceRole } from '@/src/types/workspaceRoles';
import { WORKSPACE_ID, renderSignedIn } from './workspaceGroupsTestKit';

const { mockApi, mockLocale, mockAddNotification } = vi.hoisted(() => ({
  mockApi: {
    listWorkspaceRoles: vi.fn(),
    getWorkspaceRole: vi.fn(),
    createWorkspaceRole: vi.fn(),
    updateWorkspaceRole: vi.fn(),
    deleteWorkspaceRole: vi.fn(),
    listWorkspaceGroups: vi.fn(),
  },
  mockLocale: { value: 'en' },
  mockAddNotification: vi.fn(),
}));

vi.mock('@/src/features/workspaces/data/api', () => mockApi);

vi.mock('@/src/shared/list/useSortLocale', () => ({ useSortLocale: () => mockLocale.value }));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, token: 'token', initializing: false }),
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

const dict = { ...en, locale: 'en' } as unknown as Dictionary;
const t = dict.workspaces.roles;

vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => dict }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/workspace/ws-1',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import WorkspaceRoleTab from '@/src/features/workspaces/ui/WorkspaceRoleTab';

const role = (
  roleCode: string,
  name: string,
  permissions: string[],
  system = true,
): WorkspaceRole => ({ roleCode, name, system, permissions });

const FORM_ADMIN = role('form_admin', 'Form admin', ['*']);
const FORM_SUBMITTER = role('form_submitter', 'Form submitter', [
  'document_template_read',
  'submission_create',
]);
const TEAM_MANAGER = role('team_manager', 'Team manager', [
  'form_read',
  'team_read',
  'team_update',
]);
const FORM_DESIGNER = role('form_designer', 'Form designer', ['design_read', 'form_read']);
const FIXED = [TEAM_MANAGER, FORM_ADMIN, FORM_SUBMITTER, FORM_DESIGNER];
const AUDITOR = role('custom-1', 'Auditor', ['form_read', 'submission_read'], false);

const renderTab = (tabDict: Dictionary = dict) =>
  renderSignedIn(<WorkspaceRoleTab dict={tabDict} workspaceId={WORKSPACE_ID} />);

const shownNames = () => screen.getAllByTestId(/^role-name-(?!input)/).map((c) => c.textContent);
const permissionBox = (code: keyof typeof en.workspaces.roles.permissionNames) =>
  screen.getByRole('checkbox', { name: t.permissionNames[code] });
const nameInput = () => screen.getByRole('textbox', { name: new RegExp(t.name) });

const typeSearch = async (
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLElement,
  term: string,
) => {
  await user.click(box);
  await user.paste(term);
  await user.keyboard('{Enter}');
};

describe('WorkspaceRoleTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale.value = 'en';
    window.history.replaceState(null, '', '/en/workspace/ws-1');
    window.sessionStorage.clear();
    const items = [...FIXED, AUDITOR];
    mockApi.listWorkspaceRoles.mockResolvedValue({ items });
    mockApi.getWorkspaceRole.mockImplementation(async (_token, _workspace, code) =>
      items.find((item) => item.roleCode === code),
    );
    mockApi.createWorkspaceRole.mockResolvedValue(AUDITOR);
    mockApi.updateWorkspaceRole.mockResolvedValue(AUDITOR);
    mockApi.deleteWorkspaceRole.mockResolvedValue(undefined);
  });

  it('lists each role by the name shown, with its type and permission count', async () => {
    renderTab();

    expect(await screen.findByTestId('role-name-form_admin')).toHaveTextContent(
      dict.workspaces.groups.roleNames.form_admin,
    );
    expect(mockApi.listWorkspaceRoles).toHaveBeenCalledWith('token', WORKSPACE_ID);
    expect(screen.getByTestId('role-type-form_admin')).toHaveTextContent(t.types.fixed);
    expect(screen.getByTestId('role-permissions-form_admin')).toHaveTextContent(t.allPermissions);
    expect(screen.getByTestId('role-permissions-team_manager')).toHaveTextContent('3 permissions');
    expect(screen.getByTestId('role-name-custom-1')).toHaveTextContent('Auditor');
    expect(screen.getByTestId('role-type-custom-1')).toHaveTextContent(t.types.custom);
    expect(screen.getByTestId('role-permissions-custom-1')).toHaveTextContent('2 permissions');
  });

  it('counts a single permission in the singular', async () => {
    mockApi.listWorkspaceRoles.mockResolvedValue({
      items: [role('custom-2', 'Reader', ['form_read'], false)],
    });
    renderTab();

    expect(await screen.findByTestId('role-permissions-custom-2')).toHaveTextContent(
      t.permissionCountOne,
    );
  });

  it('offers View on a fixed role, and Edit and Remove on a custom one', async () => {
    renderTab();
    await screen.findByTestId('role-name-form_admin');

    expect(screen.getByTestId('view-role-button-form_admin')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-role-button-form_admin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-role-button-form_admin')).not.toBeInTheDocument();
    expect(screen.getByTestId('edit-role-button-custom-1')).toBeInTheDocument();
    expect(screen.getByTestId('delete-role-button-custom-1')).toBeInTheDocument();
    expect(screen.queryByTestId('view-role-button-custom-1')).not.toBeInTheDocument();
  });

  it('orders by the name shown, and reverses when the name header is pressed', async () => {
    const user = userEvent.setup();
    const view = renderTab();
    await screen.findByTestId('role-name-form_admin');

    expect(shownNames()).toEqual([
      'Auditor',
      'Form Administrator',
      'Form Designer',
      'Form Submitter',
      'Team Manager',
    ]);

    await user.click(screen.getByTestId('datatable-sort-name'));
    await view.rerender();

    expect(shownNames()).toEqual([
      'Team Manager',
      'Form Submitter',
      'Form Designer',
      'Form Administrator',
      'Auditor',
    ]);
  });

  it('orders by the French names in French', async () => {
    mockLocale.value = 'fr';
    mockApi.listWorkspaceRoles.mockResolvedValue({ items: FIXED });
    renderTab({ ...fr, locale: 'fr' } as unknown as Dictionary);
    await screen.findByTestId('role-name-form_admin');

    expect(shownNames()).toEqual([
      'Administrateur de formulaire',
      'Concepteur de formulaire',
      "Gestionnaire d'équipe",
      'Soumetteur de formulaire',
    ]);
  });

  it('searches the name shown, not the stored name', async () => {
    mockLocale.value = 'fr';
    const frDict = { ...fr, locale: 'fr' } as unknown as Dictionary;
    const user = userEvent.setup();
    const view = renderTab(frDict);
    await screen.findByTestId('role-name-form_admin');
    const box = within(screen.getByTestId('search-ws-roles-text')).getByRole('textbox');

    await typeSearch(user, box, 'administrateur');
    await view.rerender();
    expect(shownNames()).toEqual(['Administrateur de formulaire']);

    await user.clear(box);
    await typeSearch(user, box, 'form admin');
    await view.rerender();
    expect(await screen.findByText(frDict.workspaces.roles.empty)).toBeInTheDocument();
  });

  it('shows the page the URL names', async () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      role(`custom-${index}`, `Role ${String(index).padStart(2, '0')}`, ['form_read'], false),
    );
    mockApi.listWorkspaceRoles.mockResolvedValue({ items });
    window.history.replaceState(null, '', '/en/workspace/ws-1?workspaceRoles.page=2');
    renderTab();

    await screen.findByTestId('role-name-custom-11');
    expect(shownNames()).toEqual(['Role 10', 'Role 11']);
  });

  it('opens a fixed role below the table for reference, with nothing to save', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('view-role-button-form_submitter'));

    const section = await screen.findByTestId('workspace-role-edit-form');
    expect(await within(section).findByTestId('fixed-role-alert')).toBeInTheDocument();
    expect(nameInput()).toBeDisabled();
    expect(nameInput()).toHaveValue(dict.workspaces.groups.roleNames.form_submitter);
    const ticked = within(section)
      .getAllByRole('checkbox')
      .filter((box) => (box as HTMLInputElement).checked);
    expect(ticked).toHaveLength(2);
    expect(permissionBox('submission_create')).toBeChecked();
    expect(permissionBox('submission_create')).toBeDisabled();
    expect(permissionBox('form_delete')).not.toBeChecked();
    expect(screen.queryByTestId('role-submit-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('role-permissions-help')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('role-cancel-button'));
    expect(screen.queryByTestId('workspace-role-edit-form')).not.toBeInTheDocument();
  });

  it('ticks every permission for a role holding the wildcard', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('view-role-button-form_admin'));

    const section = await screen.findByTestId('workspace-role-edit-form');
    await within(section).findByTestId('fixed-role-alert');
    const boxes = within(section).getAllByRole('checkbox');
    expect(boxes).toHaveLength(19);
    for (const box of boxes) expect(box).toBeChecked();
  });

  it('creates a role with what was ticked and what that needs, then closes', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByTestId('role-name-form_admin');
    const readsBefore = mockApi.listWorkspaceRoles.mock.calls.length;

    await user.click(screen.getByTestId('create-ws-role-button'));
    expect(screen.getByTestId('workspace-role-create-form')).toBeInTheDocument();
    expect(screen.getByTestId('role-submit-button')).toBeDisabled();

    await user.click(nameInput());
    await user.paste('  Clerk  ');
    expect(screen.getByTestId('role-submit-button')).toBeDisabled();

    await user.click(permissionBox('submission_review'));
    expect(permissionBox('submission_read')).toBeChecked();
    expect(permissionBox('form_read')).toBeChecked();

    await user.click(screen.getByTestId('role-submit-button'));
    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', text: t.createSuccess }),
      ),
    );
    const [, workspaceId, body] = mockApi.createWorkspaceRole.mock.calls[0];
    expect(workspaceId).toBe(WORKSPACE_ID);
    expect(body.name).toBe('Clerk');
    expect(new Set(body.permissionCodes)).toEqual(
      new Set(['submission_review', 'submission_read', 'form_read']),
    );
    expect(screen.queryByTestId('workspace-role-create-form')).not.toBeInTheDocument();
    expect(mockApi.listWorkspaceRoles.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it('saves without a permission that was auto-ticked and then unticked', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('create-ws-role-button'));
    await user.click(nameInput());
    await user.paste('Add-on');
    await user.click(permissionBox('submission_read'));
    await user.click(permissionBox('form_read'));
    expect(permissionBox('form_read')).not.toBeChecked();
    expect(permissionBox('submission_read')).toBeChecked();

    await user.click(screen.getByTestId('role-submit-button'));
    await waitFor(() => expect(mockApi.createWorkspaceRole).toHaveBeenCalled());
    expect(mockApi.createWorkspaceRole.mock.calls[0][2].permissionCodes).toEqual([
      'submission_read',
    ]);
  });

  it('will not save a role with no permissions left', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('edit-role-button-custom-1'));
    await screen.findByDisplayValue('Auditor');
    await user.click(permissionBox('form_read'));
    await user.click(permissionBox('submission_read'));

    expect(screen.getByTestId('role-submit-button')).toBeDisabled();
  });

  it('says why a create was refused and keeps the form open', async () => {
    const user = userEvent.setup();
    mockApi.createWorkspaceRole.mockRejectedValue(
      new ApiError('A role with this name already exists', 409, 'role_name_taken'),
    );
    renderTab();
    await user.click(await screen.findByTestId('create-ws-role-button'));
    await user.click(nameInput());
    await user.paste('Auditor');
    await user.click(permissionBox('form_read'));
    await user.click(screen.getByTestId('role-submit-button'));

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: en.apiErrors.role_name_taken }),
      ),
    );
    expect(screen.getByTestId('workspace-role-create-form')).toBeInTheDocument();
  });

  it('seeds an edit from the role read by code, enabled', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('edit-role-button-custom-1'));

    await screen.findByDisplayValue('Auditor');
    expect(mockApi.getWorkspaceRole).toHaveBeenCalledWith('token', WORKSPACE_ID, 'custom-1');
    expect(nameInput()).toBeEnabled();
    expect(permissionBox('submission_read')).toBeChecked();
    expect(permissionBox('submission_read')).toBeEnabled();
    expect(screen.queryByTestId('fixed-role-alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('role-permissions-help')).toHaveTextContent(t.permissionsHelp);
  });

  it('sends only the name when only the name changed', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('edit-role-button-custom-1'));
    await screen.findByDisplayValue('Auditor');
    await user.clear(nameInput());
    await user.paste('Inspector');
    await user.click(screen.getByTestId('role-submit-button'));

    await waitFor(() =>
      expect(mockApi.updateWorkspaceRole).toHaveBeenCalledWith('token', WORKSPACE_ID, 'custom-1', {
        name: 'Inspector',
      }),
    );
  });

  it('sends only the permissions when only they changed', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('edit-role-button-custom-1'));
    await screen.findByDisplayValue('Auditor');
    await user.click(permissionBox('team_read'));
    await user.click(screen.getByTestId('role-submit-button'));

    await waitFor(() => expect(mockApi.updateWorkspaceRole).toHaveBeenCalled());
    const [, , , body] = mockApi.updateWorkspaceRole.mock.calls[0];
    expect(Object.keys(body)).toEqual(['permissionCodes']);
    expect(new Set(body.permissionCodes)).toEqual(
      new Set(['form_read', 'submission_read', 'team_read']),
    );
  });

  it('sends nothing when nothing changed, and still closes', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('edit-role-button-custom-1'));
    await screen.findByDisplayValue('Auditor');
    await user.click(screen.getByTestId('role-submit-button'));

    await waitFor(() =>
      expect(screen.queryByTestId('workspace-role-edit-form')).not.toBeInTheDocument(),
    );
    expect(mockApi.updateWorkspaceRole).not.toHaveBeenCalled();
  });

  it('removes a role once confirmed, closing its open form', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('edit-role-button-custom-1'));
    await screen.findByDisplayValue('Auditor');
    const readsBefore = mockApi.listWorkspaceRoles.mock.calls.length;

    await user.click(screen.getByTestId('delete-role-button-custom-1'));
    await user.click(screen.getByRole('button', { name: t.deleteRole }));

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', text: t.deleteSuccess }),
      ),
    );
    expect(mockApi.deleteWorkspaceRole).toHaveBeenCalledWith('token', WORKSPACE_ID, 'custom-1');
    expect(mockApi.listWorkspaceRoles.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(screen.queryByTestId('workspace-role-edit-form')).not.toBeInTheDocument();
  });

  it('says a role is still on a group when the delete is refused, and keeps it', async () => {
    const user = userEvent.setup();
    mockApi.deleteWorkspaceRole.mockRejectedValue(
      new ApiError('This role is still assigned to a group', 409, 'role_in_use'),
    );
    renderTab();
    await user.click(await screen.findByTestId('delete-role-button-custom-1'));
    await user.click(screen.getByRole('button', { name: t.deleteRole }));

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: en.apiErrors.role_in_use }),
      ),
    );
    expect(screen.getByTestId('role-name-custom-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.deleteRole })).not.toBeInTheDocument();
  });

  it('re-reads the list after a refused edit, as the role may have gone', async () => {
    const user = userEvent.setup();
    mockApi.updateWorkspaceRole.mockRejectedValue(new ApiError('Role not found', 404));
    renderTab();
    await user.click(await screen.findByTestId('edit-role-button-custom-1'));
    await screen.findByDisplayValue('Auditor');
    await user.clear(nameInput());
    await user.paste('Inspector');
    const readsBefore = mockApi.listWorkspaceRoles.mock.calls.length;

    await user.click(screen.getByTestId('role-submit-button'));

    await waitFor(() =>
      expect(mockApi.listWorkspaceRoles.mock.calls.length).toBeGreaterThan(readsBefore),
    );
  });

  it('re-reads the list after a refused delete', async () => {
    const user = userEvent.setup();
    mockApi.deleteWorkspaceRole.mockRejectedValue(
      new ApiError('This role is still assigned to a group', 409, 'role_in_use'),
    );
    renderTab();
    await user.click(await screen.findByTestId('delete-role-button-custom-1'));
    const readsBefore = mockApi.listWorkspaceRoles.mock.calls.length;
    await user.click(screen.getByRole('button', { name: t.deleteRole }));

    await waitFor(() =>
      expect(mockApi.listWorkspaceRoles.mock.calls.length).toBeGreaterThan(readsBefore),
    );
  });

  it('shows no fields when the role cannot be read', async () => {
    const user = userEvent.setup();
    mockApi.getWorkspaceRole.mockRejectedValue(new ApiError('Request failed (500)', 500));
    renderTab();
    await user.click(await screen.findByTestId('edit-role-button-custom-1'));

    expect(await screen.findByTestId('role-load-error')).toHaveTextContent(t.roleLoadError);
    expect(screen.queryByTestId('role-submit-button')).not.toBeInTheDocument();
  });

  it('reports a failed load in the table', async () => {
    mockApi.listWorkspaceRoles.mockRejectedValue(new ApiError('Request failed (500)', 500));
    renderTab();

    expect(await screen.findByText(t.loadError)).toBeInTheDocument();
  });
});
