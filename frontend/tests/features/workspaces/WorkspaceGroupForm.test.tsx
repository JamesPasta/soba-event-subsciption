import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSWRConfig } from 'swr';

import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import { WORKSPACE_GROUP_NAME_MAX_LENGTH, type WorkspaceGroup } from '@/src/types/workspaceGroups';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import {
  ADMINS,
  AUDITOR,
  REVIEWERS,
  ROLES,
  WORKSPACE_ID,
  renderSignedIn,
} from './workspaceGroupsTestKit';

const { mockApi, mockAddNotification } = vi.hoisted(() => ({
  mockApi: {
    listWorkspaceRoles: vi.fn(),
    getWorkspaceGroup: vi.fn(),
    createWorkspaceGroup: vi.fn(),
    renameWorkspaceGroup: vi.fn(),
    setWorkspaceGroupRoles: vi.fn(),
    deleteWorkspaceGroup: vi.fn(),
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
const t = dict.workspaces.groups;

vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => dict }));

import { useWorkspaceRoles } from '@/src/features/workspaces/data/useWorkspaceRoles';
import WorkspaceGroupForm from '@/src/features/workspaces/ui/WorkspaceGroupForm';

const onDone = vi.fn();

const editForm = (groupId?: string) => (
  <WorkspaceGroupForm dict={dict} workspaceId={WORKSPACE_ID} groupId={groupId} onDone={onDone} />
);

const renderForm = (groupId?: string) => renderSignedIn(editForm(groupId));

const nameInput = () => screen.getByRole('textbox', { name: new RegExp(t.name) });
const roleBox = (code: keyof typeof en.workspaces.groups.roleNames) =>
  screen.getByRole('checkbox', { name: t.roleNames[code] });
const saveButton = () => screen.getByTestId('group-submit-button');
const customLabel = (name: string) => t.customRoleName.replace('{name}', name);

describe('WorkspaceGroupForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.listWorkspaceRoles.mockResolvedValue(ROLES);
    mockApi.getWorkspaceGroup.mockResolvedValue(REVIEWERS);
  });

  it('creates a group with the name and the roles ticked', async () => {
    const user = userEvent.setup();
    mockApi.createWorkspaceGroup.mockResolvedValue(REVIEWERS);
    renderForm();

    await user.click(await screen.findByRole('textbox', { name: new RegExp(t.name) }));
    await user.paste('  Approvers  ');
    await user.click(roleBox('form_designer'));
    await user.click(saveButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockApi.createWorkspaceGroup).toHaveBeenCalledWith('token', WORKSPACE_ID, {
      name: 'Approvers',
      roleCodes: ['form_designer'],
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: t.createSuccess }),
    );
    expect(mockApi.getWorkspaceGroup).not.toHaveBeenCalled();
  });

  it('names the role list, with its help text, as one group of checkboxes', async () => {
    renderForm();
    const roles = await screen.findByRole('group', { name: t.roles });
    expect(roles).toHaveAccessibleDescription(t.rolesHelp);
  });

  it("offers the workspace's own roles by name, marked custom, and assigns one by its code", async () => {
    const user = userEvent.setup();
    mockApi.createWorkspaceGroup.mockResolvedValue(REVIEWERS);
    renderForm();

    await user.click(await screen.findByRole('checkbox', { name: customLabel(AUDITOR.name) }));
    await user.click(nameInput());
    await user.paste('Auditors');
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockApi.createWorkspaceGroup).toHaveBeenCalledWith('token', WORKSPACE_ID, {
        name: 'Auditors',
        roleCodes: [AUDITOR.roleCode],
      }),
    );
    expect(mockApi.listWorkspaceRoles).toHaveBeenCalledWith('token', WORKSPACE_ID);
  });

  it('lists the roles in the order of the names shown', async () => {
    renderForm();
    const roles = await screen.findByRole('group', { name: t.roles });

    expect(
      Array.from(roles.querySelectorAll('label')).map((label) => label.textContent?.trim()),
    ).toEqual([
      customLabel(AUDITOR.name),
      t.roleNames.form_admin,
      t.roleNames.form_designer,
      t.roleNames.submission_reviewer,
    ]);
  });

  it('limits the name to what the server accepts', async () => {
    renderForm(REVIEWERS.id);
    expect(await screen.findByRole('textbox', { name: new RegExp(t.name) })).toHaveAttribute(
      'maxlength',
      String(WORKSPACE_GROUP_NAME_MAX_LENGTH),
    );
  });

  it('will not save a group without a name', async () => {
    renderForm();
    await screen.findByRole('textbox', { name: new RegExp(t.name) });
    expect(saveButton()).toBeDisabled();
  });

  it('seeds an edit from the group read by id', async () => {
    renderForm(REVIEWERS.id);

    expect(await screen.findByDisplayValue(REVIEWERS.name)).toBeInTheDocument();
    expect(roleBox('submission_reviewer')).toBeChecked();
    expect(roleBox('form_admin')).not.toBeChecked();
    expect(mockApi.getWorkspaceGroup).toHaveBeenCalledWith(
      'token',
      WORKSPACE_ID,
      REVIEWERS.id,
      'en',
    );
  });

  it('sends only a rename when only the name changed', async () => {
    const user = userEvent.setup();
    mockApi.renameWorkspaceGroup.mockResolvedValue(REVIEWERS);
    renderForm(REVIEWERS.id);
    await screen.findByDisplayValue(REVIEWERS.name);

    await user.clear(nameInput());
    await user.paste('Senior reviewers');
    await user.click(saveButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockApi.renameWorkspaceGroup).toHaveBeenCalledWith('token', WORKSPACE_ID, REVIEWERS.id, {
      name: 'Senior reviewers',
    });
    expect(mockApi.setWorkspaceGroupRoles).not.toHaveBeenCalled();
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: t.updateSuccess }),
    );
  });

  it('sends only the roles when only the roles changed', async () => {
    const user = userEvent.setup();
    mockApi.setWorkspaceGroupRoles.mockResolvedValue(REVIEWERS);
    renderForm(REVIEWERS.id);
    await screen.findByDisplayValue(REVIEWERS.name);

    await user.click(roleBox('form_admin'));
    await user.click(saveButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockApi.setWorkspaceGroupRoles).toHaveBeenCalledWith(
      'token',
      WORKSPACE_ID,
      REVIEWERS.id,
      ['submission_reviewer', 'form_admin'],
    );
    expect(mockApi.renameWorkspaceGroup).not.toHaveBeenCalled();
  });

  it('shows a system group read-only, with nothing to save', async () => {
    const user = userEvent.setup();
    mockApi.getWorkspaceGroup.mockResolvedValue(ADMINS);
    renderForm(ADMINS.id);

    expect(await screen.findByTestId('system-group-alert')).toBeInTheDocument();
    expect(nameInput()).toBeDisabled();
    expect(roleBox('form_admin')).toBeDisabled();
    expect(saveButton()).toBeDisabled();

    await user.click(saveButton());
    expect(mockApi.renameWorkspaceGroup).not.toHaveBeenCalled();
    expect(mockApi.setWorkspaceGroupRoles).not.toHaveBeenCalled();
    expect(mockAddNotification).not.toHaveBeenCalled();
  });

  it('keeps the form open and reports a failed save', async () => {
    const user = userEvent.setup();
    mockApi.createWorkspaceGroup.mockRejectedValue(new ApiError('Request failed (500)', 500));
    renderForm();

    await user.click(await screen.findByRole('textbox', { name: new RegExp(t.name) }));
    await user.paste('Approvers');
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: t.createError }),
      ),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(nameInput()).toHaveValue('Approvers');
  });

  it('says why a create was refused when the name is already in use', async () => {
    const user = userEvent.setup();
    mockApi.createWorkspaceGroup.mockRejectedValue(
      new ApiError('A group with this name already exists', 409, 'group_name_taken'),
    );
    renderForm();

    await user.click(await screen.findByRole('textbox', { name: new RegExp(t.name) }));
    await user.paste(REVIEWERS.name);
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: en.apiErrors.group_name_taken }),
      ),
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says why a rename was refused when the name is already in use', async () => {
    const user = userEvent.setup();
    mockApi.renameWorkspaceGroup.mockRejectedValue(
      new ApiError('A group with this name already exists', 409, 'group_name_taken'),
    );
    renderForm(REVIEWERS.id);
    await screen.findByDisplayValue(REVIEWERS.name);

    await user.clear(nameInput());
    await user.paste(ADMINS.name);
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: en.apiErrors.group_name_taken }),
      ),
    );
  });

  it('shows no fields when the group cannot be read', async () => {
    mockApi.getWorkspaceGroup.mockRejectedValue(new ApiError('Request failed (404)', 404));
    renderForm(REVIEWERS.id);

    expect(await screen.findByTestId('group-load-error')).toHaveTextContent(t.groupLoadError);
    expect(screen.queryByTestId('group-name-input')).not.toBeInTheDocument();
  });

  it('keeps what was typed when a later read of the roles fails', async () => {
    const user = userEvent.setup();
    let reread: () => Promise<void> = () => Promise.resolve();
    function Reread() {
      reread = useWorkspaceRoles(WORKSPACE_ID).refresh;
      return null;
    }
    renderSignedIn(
      <>
        <Reread />
        {editForm()}
      </>,
    );
    await user.click(await screen.findByRole('textbox', { name: new RegExp(t.name) }));
    await user.paste('Half typed');
    const readsBefore = mockApi.listWorkspaceRoles.mock.calls.length;

    mockApi.listWorkspaceRoles.mockRejectedValue(new ApiError('Request failed (500)', 500));
    await act(async () => {
      await reread().catch(() => undefined);
    });

    await waitFor(() =>
      expect(mockApi.listWorkspaceRoles.mock.calls.length).toBeGreaterThan(readsBefore),
    );
    expect(nameInput()).toHaveValue('Half typed');
    expect(screen.queryByTestId('group-roles-error')).not.toBeInTheDocument();
  });

  it('keeps what was typed when a later read of the group fails', async () => {
    const user = userEvent.setup();
    let reread: () => Promise<unknown> = () => Promise.resolve();
    function Reread() {
      const { mutate } = useSWRConfig();
      reread = () => mutate(['workspace-group', WORKSPACE_ID, REVIEWERS.id, 'en']);
      return null;
    }
    renderSignedIn(
      <>
        <Reread />
        {editForm(REVIEWERS.id)}
      </>,
    );
    await screen.findByDisplayValue(REVIEWERS.name);
    await user.clear(nameInput());
    await user.paste('Half typed');
    const readsBefore = mockApi.getWorkspaceGroup.mock.calls.length;

    mockApi.getWorkspaceGroup.mockRejectedValue(new ApiError('Request failed (500)', 500));
    await act(async () => {
      await reread().catch(() => undefined);
    });

    await waitFor(() =>
      expect(mockApi.getWorkspaceGroup.mock.calls.length).toBeGreaterThan(readsBefore),
    );
    expect(nameInput()).toHaveValue('Half typed');
    expect(screen.queryByTestId('group-load-error')).not.toBeInTheDocument();
  });

  it('shows no fields when the roles cannot be read', async () => {
    mockApi.listWorkspaceRoles.mockRejectedValue(new ApiError('Request failed (500)', 500));
    renderForm();

    expect(await screen.findByTestId('group-roles-error')).toHaveTextContent(t.rolesLoadError);
    expect(screen.queryByTestId('group-name-input')).not.toBeInTheDocument();
  });

  it('reads the group again on the next edit rather than reusing the last read', async () => {
    // The reopen lands inside the app's dedupe window.
    const view = renderSignedIn(editForm(REVIEWERS.id), { shipped: true });
    await screen.findByDisplayValue(REVIEWERS.name);
    // Closed, as the tab closes it: the providers and their cache stay.
    await view.show(null);

    mockApi.getWorkspaceGroup.mockResolvedValue({ ...REVIEWERS, roles: ['form_admin'] });
    await view.show(editForm(REVIEWERS.id));

    await waitFor(() => expect(roleBox('form_admin')).toBeChecked());
    expect(roleBox('submission_reviewer')).not.toBeChecked();
    expect(mockApi.getWorkspaceGroup).toHaveBeenCalledTimes(2);
  });

  it('reads the group again when reopened before the first read returns', async () => {
    const firstRead = pendingRead();
    mockApi.getWorkspaceGroup
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce({ ...REVIEWERS, roles: ['form_admin'] });
    const view = renderForm(REVIEWERS.id);
    await waitFor(() => expect(mockApi.getWorkspaceGroup).toHaveBeenCalledTimes(1));

    await view.show(null);
    await view.show(editForm(REVIEWERS.id));
    await act(async () => firstRead.finish(REVIEWERS));

    await waitFor(() => expect(roleBox('form_admin')).toBeChecked());
    expect(mockApi.getWorkspaceGroup).toHaveBeenCalledTimes(2);
  });

  // StrictMode runs each effect's cleanup and setup again on mount, while the first read is out.
  it('reads the group under StrictMode', async () => {
    const firstRead = pendingRead();
    mockApi.getWorkspaceGroup.mockReturnValueOnce(firstRead.promise);
    const view = renderSignedIn(<></>, { strict: true });
    await view.show(editForm(REVIEWERS.id));
    await act(async () => firstRead.finish(REVIEWERS));

    expect(await screen.findByDisplayValue(REVIEWERS.name)).toBeInTheDocument();
  });
});

/** A group read that stays out until the test finishes it. */
function pendingRead() {
  let finish: (group: WorkspaceGroup) => void = () => undefined;
  const promise = new Promise<WorkspaceGroup>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}
