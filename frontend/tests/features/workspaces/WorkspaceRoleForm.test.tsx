import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSWRConfig } from 'swr';

import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { WORKSPACE_ROLE_NAME_MAX_LENGTH, type WorkspaceRole } from '@/src/types/workspaceRoles';
import { WORKSPACE_ID, renderSignedIn } from './workspaceGroupsTestKit';

const { mockApi, mockAddNotification } = vi.hoisted(() => ({
  mockApi: {
    getWorkspaceRole: vi.fn(),
    createWorkspaceRole: vi.fn(),
    updateWorkspaceRole: vi.fn(),
    deleteWorkspaceRole: vi.fn(),
  },
  mockAddNotification: vi.fn(),
}));

vi.mock('@/src/features/workspaces/data/api', () => mockApi);

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, token: 'token', initializing: false }),
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

const dict = { ...en, locale: 'en' } as unknown as Dictionary;
const t = dict.workspaces.roles;

vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => dict }));

import WorkspaceRoleForm from '@/src/features/workspaces/ui/WorkspaceRoleForm';

const AUDITOR: WorkspaceRole = {
  roleCode: 'custom-1',
  name: 'Auditor',
  system: false,
  permissions: ['form_read', 'submission_read'],
};

const onDone = vi.fn();

const editForm = (roleCode?: string) => (
  <WorkspaceRoleForm dict={dict} workspaceId={WORKSPACE_ID} roleCode={roleCode} onDone={onDone} />
);

const nameInput = () => screen.getByRole('textbox', { name: new RegExp(t.name) });
const permissionBox = (code: keyof typeof en.workspaces.roles.permissionNames) =>
  screen.getByRole('checkbox', { name: t.permissionNames[code] });

/** A role read that stays out until the test finishes it. */
function pendingRead() {
  let finish: (role: WorkspaceRole) => void = () => undefined;
  const promise = new Promise<WorkspaceRole>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

describe('WorkspaceRoleForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getWorkspaceRole.mockResolvedValue(AUDITOR);
  });

  it('limits the name to what the server accepts', async () => {
    renderSignedIn(editForm());
    expect(await screen.findByRole('textbox', { name: new RegExp(t.name) })).toHaveAttribute(
      'maxlength',
      String(WORKSPACE_ROLE_NAME_MAX_LENGTH),
    );
  });

  it('keeps what was typed when a later read of the role fails', async () => {
    const user = userEvent.setup();
    let reread: () => Promise<unknown> = () => Promise.resolve();
    function Reread() {
      const { mutate } = useSWRConfig();
      reread = () => mutate(['workspace-role', WORKSPACE_ID, AUDITOR.roleCode]);
      return null;
    }
    renderSignedIn(
      <>
        <Reread />
        {editForm(AUDITOR.roleCode)}
      </>,
    );
    await screen.findByDisplayValue(AUDITOR.name);
    await user.clear(nameInput());
    await user.paste('Half typed');

    mockApi.getWorkspaceRole.mockRejectedValue(new ApiError('Request failed (500)', 500));
    await act(async () => {
      await reread().catch(() => undefined);
    });

    await waitFor(() => expect(mockApi.getWorkspaceRole).toHaveBeenCalledTimes(2));
    expect(nameInput()).toHaveValue('Half typed');
    expect(screen.queryByTestId('role-load-error')).not.toBeInTheDocument();
  });

  it('shows no fields when the first read fails', async () => {
    mockApi.getWorkspaceRole.mockRejectedValue(new ApiError('Request failed (500)', 500));
    renderSignedIn(editForm(AUDITOR.roleCode));

    expect(await screen.findByTestId('role-load-error')).toHaveTextContent(t.roleLoadError);
    expect(screen.queryByTestId('role-submit-button')).not.toBeInTheDocument();
  });

  it('reads the role again when reopened, rather than seeding from the cache', async () => {
    const view = renderSignedIn(editForm(AUDITOR.roleCode));
    await waitFor(() => expect(permissionBox('submission_read')).toBeChecked());

    // Closed, as the tab closes it: the providers and their cache stay.
    await view.show(null);

    mockApi.getWorkspaceRole.mockResolvedValue({ ...AUDITOR, permissions: ['team_read'] });
    await view.show(editForm(AUDITOR.roleCode));

    await waitFor(() => expect(permissionBox('team_read')).toBeChecked());
    expect(permissionBox('submission_read')).not.toBeChecked();
    expect(mockApi.getWorkspaceRole).toHaveBeenCalledTimes(2);
  });

  it('reads the role again when reopened before the first read returns', async () => {
    const firstRead = pendingRead();
    mockApi.getWorkspaceRole
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce({ ...AUDITOR, permissions: ['team_read'] });
    const view = renderSignedIn(editForm(AUDITOR.roleCode));
    await waitFor(() => expect(mockApi.getWorkspaceRole).toHaveBeenCalledTimes(1));

    await view.show(null);
    await view.show(editForm(AUDITOR.roleCode));
    await act(async () => firstRead.finish(AUDITOR));

    await waitFor(() => expect(permissionBox('team_read')).toBeChecked());
    expect(mockApi.getWorkspaceRole).toHaveBeenCalledTimes(2);
  });

  // StrictMode runs each effect's cleanup and setup again on mount, while the first read is out.
  it('reads the role under StrictMode', async () => {
    const firstRead = pendingRead();
    mockApi.getWorkspaceRole.mockReturnValueOnce(firstRead.promise);
    const view = renderSignedIn(<></>, { strict: true });
    await view.show(editForm(AUDITOR.roleCode));
    await act(async () => firstRead.finish(AUDITOR));

    expect(await screen.findByDisplayValue(AUDITOR.name)).toBeInTheDocument();
  });
});
