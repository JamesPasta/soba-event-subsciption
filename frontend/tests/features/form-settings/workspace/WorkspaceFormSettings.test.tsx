import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import type { Dictionary } from '@/src/types/dictionary';
import type { Audience, ReviewSettings, SubmitterSettings } from '@/src/types/formSettings';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const {
  mockGetForm,
  mockGetSettings,
  mockSetSettings,
  mockGetInheriting,
  mockGetProviders,
  mockAddNotification,
} = vi.hoisted(() => ({
  mockGetForm: vi.fn(),
  mockGetInheriting: vi.fn(),
  mockGetSettings: vi.fn(),
  mockSetSettings: vi.fn(),
  mockGetProviders: vi.fn(),
  mockAddNotification: vi.fn(),
}));

vi.mock('@/src/features/form-settings/data/api', () => ({
  getFormSettings: mockGetForm,
  getWorkspaceSettings: mockGetSettings,
  setWorkspaceSettings: mockSetSettings,
  getWorkspaceInheritingForms: mockGetInheriting,
}));

vi.mock('@/src/shared/api/sobaApi', () => ({
  fetchLoginProviders: mockGetProviders,
}));

// The confirmation dialog reads the dictionary from context.
vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => mockDict,
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import WorkspaceFormSettings from '@/src/features/form-settings/ui/WorkspaceFormSettings';
import { useFormSettings } from '@/src/features/form-settings/data/useFormSettings';

const DRAFTS = 'Allow Submitters to Save and Edit Drafts';
const PUBLIC_NOTE = 'Drafts are not available for Public forms.';
const REQUIRED = 'Select at least one login.';
const CONFLICT = 'Someone else changed these settings.';
const STATUS_UPDATES = 'Reviewers can update the status of submissions';
const REVISION = 'Submitters can revise their own submissions';

const mockDict = {
  form: {
    save: 'Save',
    settings: {
      audienceDrawerLabel: 'Form Audience',
      audienceLabel: 'Who can submit',
      audiencePublic: 'Public',
      audienceProtected: 'Protected',
      audienceMembers: 'Members only',
      audienceProviders: 'Allowed logins',
      audienceProvidersRequired: REQUIRED,
      audienceLoadError: 'Could not load the form audience.',
      audiencePublicConfirmTitle: "Make this workspace's forms public?",
      audiencePublicConfirmMessage: 'Anyone can submit every form that uses the workspace setting.',
      audienceInheritingForms: 'Forms using the workspace setting: {count}.',
      audienceInheritingFormsUnknown: 'The number of forms could not be loaded.',
      audiencePublicConfirmLabel: 'Make public',
      submitterSettingsDrawerLabel: 'Submitter Settings',
      allowSubmitterDraftsLabel: DRAFTS,
      allowSubmitterDraftsPublicNote: PUBLIC_NOTE,
      submitterSettingsLoadError: 'Could not load submitter settings.',
      reviewSettingsDrawerLabel: 'Review Settings',
      allowStatusUpdatesLabel: STATUS_UPDATES,
      allowSubmitterRevisionLabel: REVISION,
      reviewSettingsLoadError: 'Could not load review settings.',
      formSettingsDrawerSaveSuccessMessage: 'Changes saved.',
      formSettingsDrawerSaveErrorMessage: 'Save failed.',
      settingsConflictMessage: CONFLICT,
    },
  },
  workspaces: { formSettingsIntro: 'These settings are shared by every form in this workspace.' },
  modal: { dialogActions: 'Dialog actions' },
  general: {
    cancel: 'Cancel',
    noAccess: 'You do not have access to this.',
    sessionExpired: 'Your session has ended.',
  },
} as unknown as Dictionary;

const PROVIDERS = [
  { code: 'azureidir', name: 'IDIR - MFA' },
  { code: 'bceidbusiness', name: 'BCeID Business' },
];
const IDIR: Audience = { mode: 'protected', idps: ['azureidir'] };

let audience: Audience;
let submitter: SubmitterSettings;
let review: ReviewSettings;
let store: ReturnType<typeof makeStore>;

// One cache for everything rendered, as the app has.
function renderWithCache(ui: React.ReactNode) {
  return render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        {ui}
      </SWRConfig>
    </Provider>,
  );
}

const renderTab = () =>
  renderWithCache(<WorkspaceFormSettings dict={mockDict} workspaceId="ws1" />);

const input = (testId: string) =>
  screen.getByTestId(testId).querySelector('input') as HTMLInputElement;
const radio = (mode: string) => input(`audience-mode-${mode}`);
const drafts = () => input('workspace-settings-allow-drafts');
const audienceSave = () => screen.getByTestId('form-settings-workspace-audience-save');
const submitterSave = () => screen.getByTestId('form-settings-workspace-submitter-save');
const statusUpdates = () => input('workspace-settings-allow-status-updates');
const revision = () => input('workspace-settings-allow-submitter-revision');
const reviewSave = () => screen.getByTestId('form-settings-workspace-review-save');

// A form's audience read, as a form drawer elsewhere in the app would hold it.
function FormAudienceProbe() {
  const { settings } = useFormSettings<{ effective: Audience }>('audience', 'f1');
  return <span data-testid="form-probe">{settings?.effective.mode ?? 'loading'}</span>;
}

function WithFormProbe() {
  const [shown, setShown] = React.useState(true);
  return (
    <>
      <button type="button" onClick={() => setShown((value) => !value)}>
        toggle form
      </button>
      {shown && <FormAudienceProbe />}
      <WorkspaceFormSettings dict={mockDict} workspaceId="ws1" />
    </>
  );
}

// The tab remounts when the workspace changes, while the app's cache stays.
function Remountable() {
  const [mount, setMount] = React.useState(0);
  return (
    <>
      <button type="button" onClick={() => setMount((count) => count + 1)}>
        remount
      </button>
      <WorkspaceFormSettings key={mount} dict={mockDict} workspaceId="ws1" />
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('WorkspaceFormSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    audience = IDIR;
    submitter = { allowSubmitterDrafts: false };
    review = { allowStatusUpdates: false, allowSubmitterRevision: false };
    mockGetProviders.mockResolvedValue({ items: PROVIDERS });
    mockGetInheriting.mockResolvedValue({ count: 3 });
    mockGetSettings.mockImplementation((_token: string, _ws: string, key: string) =>
      Promise.resolve({ values: { audience, submitter, review }[key], version: 1 }),
    );
    mockSetSettings.mockImplementation((_token: string, _ws: string, _key: string, body: unknown) =>
      Promise.resolve(body),
    );
  });

  it("shows the intro and the workspace's audience and drafts setting", async () => {
    renderTab();
    expect(screen.getByTestId('workspace-form-settings-intro')).toBeInTheDocument();
    await waitFor(() => expect(radio('protected')).toBeEnabled());

    expect(radio('protected')).toBeChecked();
    expect(input('audience-idp-azureidir')).toBeChecked();
    expect(drafts()).not.toBeChecked();
    expect(mockGetSettings).toHaveBeenCalledWith('token', 'ws1', 'audience');
    expect(mockGetSettings).toHaveBeenCalledWith('token', 'ws1', 'submitter');
  });

  it('saves the audience, and a Public audience notes that drafts are off without locking them', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(radio('protected')).toBeEnabled());
    expect(screen.queryByTestId('workspace-settings-allow-drafts-public-note')).toBeNull();

    await user.click(screen.getByText('Public'));
    await user.click(audienceSave());
    await user.click(await screen.findByTestId('confirm-modal-confirm'));

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'ws1', 'audience', {
        values: { mode: 'public', idps: [] },
        version: 1,
      }),
    );
    expect(
      await screen.findByTestId('workspace-settings-allow-drafts-public-note'),
    ).toHaveTextContent(PUBLIC_NOTE);
    expect(drafts()).toBeEnabled();
  });

  it('asks before making the workspace public, says how many forms it reaches, and saves nothing on cancel', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(radio('protected')).toBeEnabled());

    await user.click(screen.getByText('Public'));
    await user.click(audienceSave());

    expect(await screen.findByTestId('confirm-modal-message')).toHaveTextContent(
      'Forms using the workspace setting: 3.',
    );
    expect(mockGetInheriting).toHaveBeenCalledWith('token', 'ws1', 'audience');
    await user.click(screen.getByTestId('confirm-modal-cancel'));

    await waitFor(() => expect(screen.queryByTestId('confirm-modal-message')).toBeNull());
    expect(mockSetSettings).not.toHaveBeenCalled();
    expect(radio('public')).toBeChecked();
  });

  // Forms change between confirmations, so a count from an earlier one is never shown.
  it('holds the confirm until the count is read, and reads it again each time', async () => {
    const user = userEvent.setup();
    const first = deferred<{ count: number }>();
    const second = deferred<{ count: number }>();
    mockGetInheriting.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderTab();
    await waitFor(() => expect(radio('protected')).toBeEnabled());

    await user.click(screen.getByText('Public'));
    await user.click(audienceSave());
    expect(await screen.findByTestId('confirm-modal-confirm')).toBeDisabled();
    first.resolve({ count: 3 });
    await waitFor(() => expect(screen.getByTestId('confirm-modal-confirm')).toBeEnabled());
    expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
      'Forms using the workspace setting: 3.',
    );
    await user.click(screen.getByTestId('confirm-modal-cancel'));
    await waitFor(() => expect(screen.queryByTestId('confirm-modal-message')).toBeNull());

    await user.click(audienceSave());
    expect(await screen.findByTestId('confirm-modal-confirm')).toBeDisabled();
    expect(screen.getByTestId('confirm-modal-message')).not.toHaveTextContent(
      'Forms using the workspace setting',
    );
    second.resolve({ count: 5 });
    await waitFor(() =>
      expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
        'Forms using the workspace setting: 5.',
      ),
    );
    expect(mockGetInheriting).toHaveBeenCalledTimes(2);
  });

  it('reads the count again after the tab remounts', async () => {
    const user = userEvent.setup();
    const second = deferred<{ count: number }>();
    mockGetInheriting.mockResolvedValueOnce({ count: 3 }).mockReturnValueOnce(second.promise);
    renderWithCache(<Remountable />);
    await waitFor(() => expect(radio('protected')).toBeEnabled());

    await user.click(screen.getByText('Public'));
    await user.click(audienceSave());
    await waitFor(() =>
      expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
        'Forms using the workspace setting: 3.',
      ),
    );
    await user.click(screen.getByTestId('confirm-modal-cancel'));
    await waitFor(() => expect(screen.queryByTestId('confirm-modal-message')).toBeNull());

    await user.click(screen.getByText('remount'));
    await waitFor(() => expect(radio('protected')).toBeEnabled());
    await user.click(screen.getByText('Public'));
    await user.click(audienceSave());
    expect(await screen.findByTestId('confirm-modal-confirm')).toBeDisabled();
    expect(screen.getByTestId('confirm-modal-message')).not.toHaveTextContent(
      'Forms using the workspace setting',
    );
    second.resolve({ count: 5 });
    await waitFor(() =>
      expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
        'Forms using the workspace setting: 5.',
      ),
    );
  });

  it('says when the count cannot be read and still lets the change through', async () => {
    const user = userEvent.setup();
    mockGetInheriting.mockRejectedValue(new ApiError('Boom', 500));
    renderTab();
    await waitFor(() => expect(radio('protected')).toBeEnabled());

    await user.click(screen.getByText('Public'));
    await user.click(audienceSave());
    await waitFor(() =>
      expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
        'The number of forms could not be loaded.',
      ),
    );
    await user.click(screen.getByTestId('confirm-modal-confirm'));

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'ws1', 'audience', {
        values: { mode: 'public', idps: [] },
        version: 1,
      }),
    );
  });

  // A save with nothing changed would still move the version on and stale someone else's edit.
  it('keeps each Save off until its group changes', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(radio('protected')).toBeEnabled());
    await waitFor(() => expect(drafts()).toBeEnabled());

    expect(audienceSave()).toBeDisabled();
    expect(submitterSave()).toBeDisabled();
    await user.click(screen.getByText('Members only'));
    expect(audienceSave()).toBeEnabled();
    expect(submitterSave()).toBeDisabled();
    await user.click(screen.getByText(DRAFTS));
    expect(submitterSave()).toBeEnabled();
  });

  // Only widening to Public reaches forms in a way worth stopping for.
  it('saves without asking when the workspace is already public', async () => {
    const user = userEvent.setup();
    audience = { mode: 'public', idps: [] };
    renderTab();
    await waitFor(() => expect(radio('public')).toBeEnabled());

    await user.click(screen.getByText('Members only'));
    await user.click(screen.getByText('Public'));
    await user.click(audienceSave());

    await waitFor(() => expect(mockSetSettings).toHaveBeenCalled());
    expect(screen.queryByTestId('confirm-modal-message')).toBeNull();
    expect(mockGetInheriting).not.toHaveBeenCalled();
  });

  it('needs a login before a protected audience saves', async () => {
    const user = userEvent.setup();
    audience = { mode: 'members', idps: [] };
    renderTab();
    await waitFor(() => expect(radio('members')).toBeEnabled());

    await user.click(screen.getByText('Protected'));
    expect(screen.getByText(REQUIRED)).toBeInTheDocument();
    expect(audienceSave()).toBeDisabled();

    await user.click(screen.getByText('BCeID Business'));
    await user.click(audienceSave());
    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'ws1', 'audience', {
        values: { mode: 'protected', idps: ['bceidbusiness'] },
        version: 1,
      }),
    );
  });

  it('saves the drafts setting', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(drafts()).toBeEnabled());

    await user.click(screen.getByText(DRAFTS));
    await user.click(submitterSave());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'ws1', 'submitter', {
        values: { allowSubmitterDrafts: true },
        version: 1,
      }),
    );
    expect(drafts()).toBeChecked();
    expect(mockAddNotification).toHaveBeenCalledWith({ type: 'success', text: 'Changes saved.' });
  });

  it('reloads the workspace settings and says so when someone else saved first', async () => {
    const user = userEvent.setup();
    mockSetSettings.mockRejectedValue(new ApiError('changed', 409));
    renderTab();
    await waitFor(() => expect(drafts()).toBeEnabled());
    submitter = { allowSubmitterDrafts: false };

    await user.click(screen.getByText(DRAFTS));
    await user.click(submitterSave());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'error', text: CONFLICT }),
    );
    expect(drafts()).not.toBeChecked();
    expect(mockGetSettings.mock.calls.filter((call) => call[2] === 'submitter')).toHaveLength(2);
  });

  it('keeps the edit and reports a failed save', async () => {
    const user = userEvent.setup();
    mockSetSettings.mockRejectedValue(new Error('boom'));
    renderTab();
    await waitFor(() => expect(drafts()).toBeEnabled());

    await user.click(screen.getByText(DRAFTS));
    await user.click(submitterSave());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'error', text: 'Save failed.' }),
    );
    expect(drafts()).toBeChecked();
  });

  it('says when a group cannot be read and saves nothing', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockImplementation((_token: string, _ws: string, key: string) =>
      key === 'audience'
        ? Promise.reject(new ApiError('Boom', 500))
        : Promise.resolve({ values: submitter, version: 1 }),
    );
    renderTab();

    expect(await screen.findByTestId('workspace-settings-audience-error')).toHaveTextContent(
      'Could not load the form audience.',
    );
    expect(audienceSave()).toBeDisabled();
    await user.click(audienceSave());
    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  // The form view was read before the save and is not mounted when it happens.
  it('makes a form that inherits read its audience again after a workspace save', async () => {
    const user = userEvent.setup();
    mockGetForm
      .mockResolvedValueOnce({ effective: IDIR })
      .mockResolvedValue({ effective: { mode: 'public', idps: [] } });
    renderWithCache(<WithFormProbe />);
    expect(await screen.findByText('protected')).toBeInTheDocument();
    await user.click(screen.getByText('toggle form'));
    await waitFor(() => expect(radio('protected')).toBeEnabled());

    await user.click(screen.getByText('Public'));
    await user.click(audienceSave());
    await user.click(await screen.findByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(mockSetSettings).toHaveBeenCalled());
    await user.click(screen.getByText('toggle form'));

    expect(await screen.findByText('public')).toBeInTheDocument();
    expect(mockGetForm).toHaveBeenCalledTimes(2);
  });

  // A 409 means another save of the workspace landed, which the form's cached view predates.
  it('makes a form that inherits read its audience again when a workspace save conflicts', async () => {
    const user = userEvent.setup();
    mockGetForm
      .mockResolvedValueOnce({ effective: IDIR })
      .mockResolvedValue({ effective: { mode: 'members', idps: [] } });
    mockSetSettings.mockRejectedValue(new ApiError('changed', 409));
    renderWithCache(<WithFormProbe />);
    expect(await screen.findByText('protected')).toBeInTheDocument();
    await user.click(screen.getByText('toggle form'));
    await waitFor(() => expect(radio('protected')).toBeEnabled());

    await user.click(screen.getByText('Members only'));
    await user.click(audienceSave());
    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'error', text: CONFLICT }),
    );
    await user.click(screen.getByText('toggle form'));

    expect(await screen.findByText('members')).toBeInTheDocument();
    expect(mockGetForm).toHaveBeenCalledTimes(2);
  });
  it("shows the workspace's review settings", async () => {
    review = { allowStatusUpdates: true, allowSubmitterRevision: false };
    renderTab();
    await waitFor(() => expect(statusUpdates()).toBeEnabled());

    expect(statusUpdates()).toBeChecked();
    expect(revision()).not.toBeChecked();
    expect(reviewSave()).toBeDisabled();
    expect(mockGetSettings).toHaveBeenCalledWith('token', 'ws1', 'review');
  });

  it('saves both review settings from the version read', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(statusUpdates()).toBeEnabled());

    await user.click(screen.getByText(STATUS_UPDATES));
    await user.click(screen.getByText(REVISION));
    await user.click(reviewSave());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'ws1', 'review', {
        values: { allowStatusUpdates: true, allowSubmitterRevision: true },
        version: 1,
      }),
    );
    expect(mockAddNotification).toHaveBeenCalledWith({ type: 'success', text: 'Changes saved.' });
  });

  it('drops a stale review edit when someone else saved first', async () => {
    const user = userEvent.setup();
    mockSetSettings.mockRejectedValue(new ApiError('Changed', 409));
    renderTab();
    await waitFor(() => expect(statusUpdates()).toBeEnabled());

    await user.click(screen.getByText(STATUS_UPDATES));
    await user.click(reviewSave());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'error', text: CONFLICT }),
    );
    expect(statusUpdates()).not.toBeChecked();
  });
});
