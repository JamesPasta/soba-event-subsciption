import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import en from '@/dictionaries/en.json';
import fr from '@/dictionaries/fr.json';
import type { Dictionary } from '@/src/types/dictionary';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import type { WorkspaceRole } from '@/src/types/workspaceRoles';
import { WORKSPACE_ID, renderSignedIn } from './workspaceGroupsTestKit';

const { mockApi, mockLocale } = vi.hoisted(() => ({
  mockApi: { listWorkspaceRoles: vi.fn() },
  mockLocale: { value: 'en' },
}));

vi.mock('@/src/features/workspaces/data/api', () => mockApi);

vi.mock('@/src/shared/list/useSortLocale', () => ({ useSortLocale: () => mockLocale.value }));

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
const ROLES = [TEAM_MANAGER, FORM_ADMIN, FORM_SUBMITTER, FORM_DESIGNER];

const renderTab = (tabDict: Dictionary = dict) =>
  renderSignedIn(<WorkspaceRoleTab dict={tabDict} workspaceId={WORKSPACE_ID} />);

const shownNames = () => screen.getAllByTestId(/^role-name-/).map((cell) => cell.textContent);

describe('WorkspaceRoleTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale.value = 'en';
    window.history.replaceState(null, '', '/en/workspace/ws-1');
    window.sessionStorage.clear();
    mockApi.listWorkspaceRoles.mockResolvedValue({ items: ROLES });
  });

  it('lists each fixed role by its dictionary name, with its type and permission count', async () => {
    renderTab();

    expect(await screen.findByTestId('role-name-form_admin')).toHaveTextContent(
      dict.workspaces.groups.roleNames.form_admin,
    );
    expect(mockApi.listWorkspaceRoles).toHaveBeenCalledWith('token', WORKSPACE_ID);
    expect(screen.getByTestId('role-type-form_admin')).toHaveTextContent(t.types.fixed);
    expect(screen.getByTestId('role-permissions-form_admin')).toHaveTextContent(t.allPermissions);
    expect(screen.getByTestId('role-permissions-team_manager')).toHaveTextContent('3 permissions');
  });

  it('shows a role with no dictionary name by its stored name, and counts one permission', async () => {
    mockApi.listWorkspaceRoles.mockResolvedValue({
      items: [role('custom-1', 'Auditor', ['submission_read'], false)],
    });
    renderTab();

    expect(await screen.findByTestId('role-name-custom-1')).toHaveTextContent('Auditor');
    expect(screen.getByTestId('role-type-custom-1')).toHaveTextContent(t.types.custom);
    expect(screen.getByTestId('role-permissions-custom-1')).toHaveTextContent(t.permissionCountOne);
  });

  it('orders by the name shown, and reverses when the name header is pressed', async () => {
    const user = userEvent.setup();
    const view = renderTab();
    await screen.findByTestId('role-name-form_admin');

    expect(shownNames()).toEqual([
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
    ]);
  });

  it('orders by the French names in French', async () => {
    mockLocale.value = 'fr';
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

    await user.click(box);
    await user.paste('administrateur');
    await user.keyboard('{Enter}');
    await view.rerender();
    expect(shownNames()).toEqual(['Administrateur de formulaire']);

    await user.clear(box);
    await user.paste('form admin');
    await user.keyboard('{Enter}');
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

  it('opens a fixed role below the table, disabled, with its own permissions ticked', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('view-role-button-form_submitter'));

    const section = within(screen.getByTestId('workspace-role-view'));
    expect(section.getByTestId('fixed-role-alert')).toBeInTheDocument();
    expect(section.getByRole('textbox', { name: new RegExp(t.name) })).toBeDisabled();
    const ticked = section
      .getAllByRole('checkbox')
      .filter((box) => (box as HTMLInputElement).checked);
    expect(ticked).toHaveLength(2);
    const submit = section.getByRole('checkbox', {
      name: t.permissionNames.submission_create,
    });
    expect(submit).toBeChecked();
    expect(submit).toBeDisabled();
    expect(
      section.getByRole('checkbox', { name: t.permissionNames.form_delete }),
    ).not.toBeChecked();
  });

  it('ticks every permission for a role holding the wildcard', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('view-role-button-form_admin'));

    const boxes = within(screen.getByTestId('workspace-role-view')).getAllByRole('checkbox');
    expect(boxes).toHaveLength(19);
    for (const box of boxes) expect(box).toBeChecked();
  });

  it('closes the role', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByTestId('view-role-button-form_admin'));
    await user.click(screen.getByTestId('role-close-button'));

    expect(screen.queryByTestId('workspace-role-view')).not.toBeInTheDocument();
  });

  it('reports a failed load in the table', async () => {
    mockApi.listWorkspaceRoles.mockRejectedValue(new ApiError('Request failed (500)', 500));
    renderTab();

    expect(await screen.findByText(t.loadError)).toBeInTheDocument();
  });
});
