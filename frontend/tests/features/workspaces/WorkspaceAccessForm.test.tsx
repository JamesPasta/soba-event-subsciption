import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import type { UserSearchUser } from '@/src/types/userSearch';
import type { WorkspaceAccessMember } from '@/src/types/workspaceAccess';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import {
  ADMINS,
  REVIEWERS,
  WORKSPACE_ID,
  group,
  groupsPage,
  renderSignedIn,
} from './workspaceGroupsTestKit';
import { REVIEWER, foundPerson } from './workspaceAccessTestKit';

const { mockGroupsApi, mockAccessApi, mockUserSearchApi, mockAddNotification, picked } = vi.hoisted(
  () => ({
    mockGroupsApi: { listWorkspaceGroups: vi.fn() },
    mockUserSearchApi: {
      fetchUserSearchCapabilities: vi.fn(),
      searchUsers: vi.fn(),
      createUserFromSearch: vi.fn(),
    },
    mockAccessApi: {
      listWorkspaceAccess: vi.fn(),
      getWorkspaceAccess: vi.fn(),
      addWorkspaceAccess: vi.fn(),
      setWorkspaceAccessGroups: vi.fn(),
      removeWorkspaceAccess: vi.fn(),
    },
    mockAddNotification: vi.fn(),
    /** The person the stub picker reports when pressed. */
    picked: { person: null as unknown },
  }),
);

vi.mock('@/src/features/workspaces/data/api', () => mockGroupsApi);
vi.mock('@/src/features/workspaces/data/accessApi', () => mockAccessApi);
vi.mock('@/src/features/user-search/data/api', () => mockUserSearchApi);

// The picker has its own tests; here it only reports a pick.
vi.mock('@/src/features/user-search/ui/UserSearchPicker', () => ({
  UserSearchPicker: ({ onSelect }: { onSelect: (user: unknown) => void }) => (
    <div data-testid="picker">
      <button type="button" onClick={() => onSelect(picked.person)}>
        pick
      </button>
    </div>
  ),
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

import WorkspaceAccessForm from '@/src/features/workspaces/ui/WorkspaceAccessForm';

const onDone = vi.fn();

const accessForm = (membershipId?: string) => (
  <WorkspaceAccessForm
    dict={dict}
    workspaceId={WORKSPACE_ID}
    membershipId={membershipId}
    onDone={onDone}
  />
);

const renderForm = (membershipId?: string) => renderSignedIn(accessForm(membershipId));

const groupBox = (name: string) => screen.getByRole('checkbox', { name });
const saveButton = () => screen.getByTestId('member-submit-button');

const pick = async (user: ReturnType<typeof userEvent.setup>, person: UserSearchUser) => {
  picked.person = person;
  await user.click(await screen.findByRole('button', { name: 'pick' }));
};

describe('WorkspaceAccessForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    picked.person = null;
    mockGroupsApi.listWorkspaceGroups.mockResolvedValue(groupsPage([ADMINS, REVIEWERS]));
    mockAccessApi.getWorkspaceAccess.mockResolvedValue(REVIEWER);
  });

  it('adds the person picked, in the groups ticked', async () => {
    const user = userEvent.setup();
    mockAccessApi.addWorkspaceAccess.mockResolvedValue(REVIEWER);
    renderForm();

    await pick(user, foundPerson());
    await user.click(await screen.findByRole('checkbox', { name: REVIEWERS.name }));
    await user.click(saveButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockAccessApi.addWorkspaceAccess).toHaveBeenCalledWith('token', WORKSPACE_ID, {
      userId: 'user-found',
      groupIds: [REVIEWERS.id],
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: t.addSuccess }),
    );
    expect(mockAccessApi.getWorkspaceAccess).not.toHaveBeenCalled();
  });

  it('offers every group read for the workspace, by name', async () => {
    renderForm();
    await screen.findByRole('checkbox', { name: ADMINS.name });
    expect(groupBox(REVIEWERS.name)).toBeInTheDocument();
    expect(mockGroupsApi.listWorkspaceGroups).toHaveBeenCalledWith('token', WORKSPACE_ID, {
      offset: 0,
      limit: 100,
      sort: 'name:asc',
      locale: 'en',
    });
  });

  it('will not add without a person and a group', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(await screen.findByRole('checkbox', { name: REVIEWERS.name }));
    expect(saveButton()).toBeDisabled();

    await user.click(groupBox(REVIEWERS.name));
    await pick(user, foundPerson());
    expect(saveButton()).toBeDisabled();
  });

  it('makes a SOBA user for a person who has not signed in, then adds them', async () => {
    const user = userEvent.setup();
    mockUserSearchApi.createUserFromSearch.mockResolvedValue({
      userId: 'user-made',
      created: true,
    });
    mockAccessApi.addWorkspaceAccess.mockResolvedValue(REVIEWER);
    renderForm();

    await pick(user, foundPerson({ sobaUserId: null }));
    await user.click(await screen.findByRole('checkbox', { name: REVIEWERS.name }));
    expect(screen.getByTestId('member-not-signed-in')).toHaveTextContent(t.notSignedIn);
    await user.click(saveButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockUserSearchApi.createUserFromSearch).toHaveBeenCalledWith(
      'token',
      { kind: 'workspace', id: WORKSPACE_ID },
      { identityProvider: 'idir', guid: 'FOUNDGUID' },
    );
    expect(mockAccessApi.addWorkspaceAccess).toHaveBeenCalledWith('token', WORKSPACE_ID, {
      userId: 'user-made',
      groupIds: [REVIEWERS.id],
    });
  });

  it('will not add a person who has not signed in when the directory gave no guid', async () => {
    const user = userEvent.setup();
    renderForm();

    await pick(user, foundPerson({ sobaUserId: null, guid: null }));
    await user.click(await screen.findByRole('checkbox', { name: REVIEWERS.name }));

    expect(screen.getByTestId('member-not-signed-in')).toHaveTextContent(t.notSignedInNoId);
    expect(saveButton()).toBeDisabled();
  });

  it('says why when the directory account cannot be confirmed, and adds no one', async () => {
    const user = userEvent.setup();
    mockUserSearchApi.createUserFromSearch.mockRejectedValue(
      new ApiError('The directory identity could not be confirmed', 422, 'identity_unconfirmed'),
    );
    renderForm();

    await pick(user, foundPerson({ sobaUserId: null }));
    await user.click(await screen.findByRole('checkbox', { name: REVIEWERS.name }));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: dict.apiErrors.identity_unconfirmed }),
      ),
    );
    expect(mockAccessApi.addWorkspaceAccess).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says when the directory no longer has the person', async () => {
    const user = userEvent.setup();
    mockUserSearchApi.createUserFromSearch.mockRejectedValue(
      new ApiError('No one with that guid was found', 404, 'person_not_found'),
    );
    renderForm();

    await pick(user, foundPerson({ sobaUserId: null }));
    await user.click(await screen.findByRole('checkbox', { name: REVIEWERS.name }));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: dict.apiErrors.person_not_found }),
      ),
    );
    expect(mockAccessApi.addWorkspaceAccess).not.toHaveBeenCalled();
  });

  it('keeps the user it made when the add fails, so trying again only adds', async () => {
    const user = userEvent.setup();
    mockUserSearchApi.createUserFromSearch.mockResolvedValue({
      userId: 'user-made',
      created: true,
    });
    mockAccessApi.addWorkspaceAccess
      .mockRejectedValueOnce(new ApiError('Request failed (500)', 500))
      .mockResolvedValueOnce(REVIEWER);
    renderForm();

    await pick(user, foundPerson({ sobaUserId: null }));
    await user.click(await screen.findByRole('checkbox', { name: REVIEWERS.name }));
    await user.click(saveButton());
    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: t.addError }),
      ),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByTestId('member-not-signed-in')).not.toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockUserSearchApi.createUserFromSearch).toHaveBeenCalledTimes(1);
    expect(mockAccessApi.addWorkspaceAccess).toHaveBeenCalledTimes(2);
    expect(mockAccessApi.addWorkspaceAccess).toHaveBeenLastCalledWith('token', WORKSPACE_ID, {
      userId: 'user-made',
      groupIds: [REVIEWERS.id],
    });
  });

  it('says why when the person already has access', async () => {
    const user = userEvent.setup();
    mockAccessApi.addWorkspaceAccess.mockRejectedValue(
      new ApiError('This person already has access to the workspace', 409, 'member_exists'),
    );
    renderForm();

    await pick(user, foundPerson());
    await user.click(await screen.findByRole('checkbox', { name: REVIEWERS.name }));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: dict.apiErrors.member_exists }),
      ),
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it('seeds an edit from the member read by id and saves the new set of groups', async () => {
    const user = userEvent.setup();
    mockAccessApi.setWorkspaceAccessGroups.mockResolvedValue(REVIEWER);
    renderForm(REVIEWER.membershipId);

    expect(await screen.findByTestId('member-identity')).toHaveTextContent('Rita Reviewer');
    expect(screen.queryByTestId('picker')).not.toBeInTheDocument();
    expect(groupBox(REVIEWERS.name)).toBeChecked();
    expect(groupBox(ADMINS.name)).not.toBeChecked();

    await user.click(groupBox(ADMINS.name));
    await user.click(saveButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockAccessApi.getWorkspaceAccess).toHaveBeenCalledWith(
      'token',
      WORKSPACE_ID,
      REVIEWER.membershipId,
      'en',
    );
    expect(mockAccessApi.setWorkspaceAccessGroups).toHaveBeenCalledWith(
      'token',
      WORKSPACE_ID,
      REVIEWER.membershipId,
      [REVIEWERS.id, ADMINS.id],
    );
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: t.updateSuccess }),
    );
  });

  it('says why when the edit would leave Form Administrators empty', async () => {
    const user = userEvent.setup();
    mockAccessApi.getWorkspaceAccess.mockResolvedValue({
      ...REVIEWER,
      groups: [
        { id: ADMINS.id, name: ADMINS.name },
        { id: REVIEWERS.id, name: REVIEWERS.name },
      ],
    });
    mockAccessApi.setWorkspaceAccessGroups.mockRejectedValue(
      new ApiError('Form administrators must keep at least one member', 409, 'last_form_admin'),
    );
    renderForm(REVIEWER.membershipId);

    await user.click(await screen.findByRole('checkbox', { name: ADMINS.name }));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text: dict.apiErrors.last_form_admin }),
      ),
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it('offers no fields to edit when the member cannot be read', async () => {
    mockAccessApi.getWorkspaceAccess.mockRejectedValue(new ApiError('Not found', 404));
    renderForm(REVIEWER.membershipId);

    expect(await screen.findByTestId('member-load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('member-submit-button')).not.toBeInTheDocument();
  });

  it('offers no fields when the groups cannot be read', async () => {
    mockGroupsApi.listWorkspaceGroups.mockRejectedValue(new ApiError('Request failed', 500));
    renderForm();

    expect(await screen.findByTestId('member-groups-error')).toHaveTextContent(t.groupsLoadError);
    expect(screen.queryByTestId('member-submit-button')).not.toBeInTheDocument();
  });

  it('offers a member their groups past the first page read, and says the list is cut short', async () => {
    const user = userEvent.setup();
    const late = group({ id: 'grp-late', name: 'Late Group' });
    mockGroupsApi.listWorkspaceGroups.mockResolvedValue(
      groupsPage([ADMINS, REVIEWERS], { limit: 100, total: 150 }),
    );
    mockAccessApi.getWorkspaceAccess.mockResolvedValue({
      ...REVIEWER,
      groups: [
        { id: REVIEWERS.id, name: REVIEWERS.name },
        { id: late.id, name: late.name },
      ],
    });
    mockAccessApi.setWorkspaceAccessGroups.mockResolvedValue(REVIEWER);
    renderForm(REVIEWER.membershipId);

    expect(await screen.findByRole('checkbox', { name: late.name })).toBeChecked();
    expect(screen.getByRole('group', { name: new RegExp(t.groups) })).toHaveAccessibleDescription(
      `${t.groupsHelp} ${dict.general.lookupTruncated.replace('{limit}', '100')}`,
    );

    await user.click(groupBox(REVIEWERS.name));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAccessApi.setWorkspaceAccessGroups).toHaveBeenCalledWith(
        'token',
        WORKSPACE_ID,
        REVIEWER.membershipId,
        [late.id],
      ),
    );
  });

  it('neither offers nor saves a member group that is no longer in the workspace', async () => {
    const user = userEvent.setup();
    mockGroupsApi.listWorkspaceGroups.mockResolvedValue(groupsPage([ADMINS]));
    mockAccessApi.setWorkspaceAccessGroups.mockResolvedValue(REVIEWER);
    renderForm(REVIEWER.membershipId);

    await screen.findByRole('checkbox', { name: ADMINS.name });
    expect(screen.queryByRole('checkbox', { name: REVIEWERS.name })).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await user.click(groupBox(ADMINS.name));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAccessApi.setWorkspaceAccessGroups).toHaveBeenCalledWith(
        'token',
        WORKSPACE_ID,
        REVIEWER.membershipId,
        [ADMINS.id],
      ),
    );
  });

  it('reads the member again on the next edit rather than reusing the last read', async () => {
    // The reopen lands inside the app's dedupe window.
    const view = renderSignedIn(accessForm(REVIEWER.membershipId), { shipped: true });
    await screen.findByTestId('member-identity');
    // Closed, as the tab closes it: the providers and their cache stay.
    await view.show(null);

    mockAccessApi.getWorkspaceAccess.mockResolvedValue({
      ...REVIEWER,
      groups: [{ id: ADMINS.id, name: ADMINS.name }],
    });
    await view.show(accessForm(REVIEWER.membershipId));

    await waitFor(() => expect(groupBox(ADMINS.name)).toBeChecked());
    expect(groupBox(REVIEWERS.name)).not.toBeChecked();
    expect(mockAccessApi.getWorkspaceAccess).toHaveBeenCalledTimes(2);
  });

  it('reads the member again when reopened before the first read returns', async () => {
    const firstRead = pendingRead();
    mockAccessApi.getWorkspaceAccess
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce({ ...REVIEWER, groups: [{ id: ADMINS.id, name: ADMINS.name }] });
    const view = renderForm(REVIEWER.membershipId);
    await waitFor(() => expect(mockAccessApi.getWorkspaceAccess).toHaveBeenCalledTimes(1));

    await view.show(null);
    await view.show(accessForm(REVIEWER.membershipId));
    await act(async () => firstRead.finish(REVIEWER));

    await waitFor(() => expect(groupBox(ADMINS.name)).toBeChecked());
    expect(mockAccessApi.getWorkspaceAccess).toHaveBeenCalledTimes(2);
  });

  // StrictMode runs each effect's cleanup and setup again on mount, while the first read is out.
  it('reads the member under StrictMode', async () => {
    const firstRead = pendingRead();
    mockAccessApi.getWorkspaceAccess.mockReturnValueOnce(firstRead.promise);
    const view = renderSignedIn(<></>, { strict: true });
    await view.show(accessForm(REVIEWER.membershipId));
    await act(async () => firstRead.finish(REVIEWER));

    expect(await screen.findByTestId('member-identity')).toHaveTextContent('Rita Reviewer');
  });
});

/** A member read that stays out until the test finishes it. */
function pendingRead() {
  let finish: (member: WorkspaceAccessMember) => void = () => undefined;
  const promise = new Promise<WorkspaceAccessMember>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}
