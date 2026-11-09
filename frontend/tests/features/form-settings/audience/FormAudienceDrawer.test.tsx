import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import type { Dictionary } from '@/src/types/dictionary';
import type { Audience, FormAudienceSettings } from '@/src/types/formSettings';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const { mockGetSettings, mockSetSettings, mockGetProviders, mockAddNotification } = vi.hoisted(
  () => ({
    mockGetSettings: vi.fn(),
    mockSetSettings: vi.fn(),
    mockGetProviders: vi.fn(),
    mockAddNotification: vi.fn(),
  }),
);

vi.mock('@/src/features/form-settings/data/api', () => ({
  getFormSettings: mockGetSettings,
  setFormSettings: mockSetSettings,
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
import FormAudienceDrawer from '@/src/features/form-settings/audience/FormAudienceDrawer';

const INHERIT = 'Use the workspace setting';
const REQUIRED = 'Select at least one login.';
const CONFLICT = 'Someone else changed these settings.';

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
      inheritWorkspaceLabel: INHERIT,
      audienceFormPublicConfirmTitle: 'Make this form public?',
      audienceFormPublicConfirmMessage: 'Anyone will be able to submit this form.',
      audiencePublicConfirmLabel: 'Make public',
      formSettingsDrawerSaveSuccessMessage: 'Changes saved.',
      formSettingsDrawerSaveErrorMessage: 'Save failed.',
      settingsConflictMessage: CONFLICT,
    },
  },
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

const inherited = (workspace: Audience): FormAudienceSettings => ({
  inherit: true,
  own: null,
  workspace,
  effective: workspace,
  version: 1,
});
const own = (values: Audience, workspace: Audience = IDIR): FormAudienceSettings => ({
  inherit: false,
  own: values,
  workspace,
  effective: values,
  version: 1,
});

let store: ReturnType<typeof makeStore>;

function renderDrawer() {
  return render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <FormAudienceDrawer dict={mockDict} drawerName="form-audience" formId="f1" />
      </SWRConfig>
    </Provider>,
  );
}

const input = (testId: string) =>
  screen.getByTestId(testId).querySelector('input') as HTMLInputElement;
const inheritBox = () => input('form-settings-audience-inherit');
const radio = (mode: string) => input(`audience-mode-${mode}`);
const login = (code: string) => input(`audience-idp-${code}`);
const saveButton = () => screen.getByTestId('form-settings-form-audience-save');

describe('FormAudienceDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    mockGetProviders.mockResolvedValue({ items: PROVIDERS });
  });

  it('shows the workspace audience read-only while the form inherits', async () => {
    mockGetSettings.mockResolvedValue(inherited(IDIR));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());

    expect(inheritBox()).toBeChecked();
    expect(radio('protected')).toBeChecked();
    expect(radio('protected')).toBeDisabled();
    expect(login('azureidir')).toBeChecked();
    expect(login('azureidir')).toBeDisabled();
    expect(mockGetSettings).toHaveBeenCalledWith('token', 'f1', 'audience');
  });

  it("starts from the workspace audience once inherit is off and saves the form's own", async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(inherited(IDIR));
    mockSetSettings.mockResolvedValue(own({ mode: 'members', idps: [] }));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());

    await user.click(screen.getByText(INHERIT));
    expect(radio('protected')).toBeEnabled();
    expect(radio('protected')).toBeChecked();
    await user.click(screen.getByText('Members only'));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'audience', {
        inherit: false,
        values: { mode: 'members', idps: [] },
        version: 1,
      }),
    );
    expect(mockAddNotification).toHaveBeenCalledWith({ type: 'success', text: 'Changes saved.' });
  });

  it('needs a login before a protected audience saves', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own({ mode: 'public', idps: [] }));
    mockSetSettings.mockResolvedValue(own({ mode: 'protected', idps: ['bceidbusiness'] }));
    renderDrawer();
    await waitFor(() => expect(radio('public')).toBeEnabled());

    await user.click(screen.getByText('Protected'));
    expect(screen.getByText(REQUIRED)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await user.click(screen.getByText('BCeID Business'));
    expect(screen.queryByText(REQUIRED)).not.toBeInTheDocument();
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'audience', {
        inherit: false,
        values: { mode: 'protected', idps: ['bceidbusiness'] },
        version: 1,
      }),
    );
  });

  // The server refuses a provider that is no longer a login provider, and it has no checkbox here.
  it('leaves out a saved login that is no longer offered', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own({ mode: 'protected', idps: ['retired', 'azureidir'] }));
    mockSetSettings.mockResolvedValue(own(IDIR));
    renderDrawer();
    await waitFor(() => expect(radio('protected')).toBeEnabled());

    await user.click(screen.getByText('BCeID Business'));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'audience', {
        inherit: false,
        values: { mode: 'protected', idps: ['azureidir', 'bceidbusiness'] },
        version: 1,
      }),
    );
  });

  // A save with nothing changed would still move the version on and stale someone else's edit.
  it('keeps Save off until something changes', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own({ mode: 'members', idps: [] }));
    renderDrawer();
    await waitFor(() => expect(radio('members')).toBeEnabled());

    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByText('Public'));
    expect(saveButton()).toBeEnabled();
    await user.click(screen.getByTestId('form-settings-form-audience-cancel'));
    expect(saveButton()).toBeDisabled();
  });

  it('goes back to the workspace audience and saves inherit only', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own({ mode: 'members', idps: [] }));
    mockSetSettings.mockResolvedValue(inherited(IDIR));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());

    await user.click(screen.getByText(INHERIT));
    expect(radio('protected')).toBeChecked();
    expect(radio('protected')).toBeDisabled();
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'audience', {
        inherit: true,
        version: 1,
      }),
    );
  });

  it('asks before making the form public and saves nothing on cancel', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own(IDIR));
    mockSetSettings.mockResolvedValue(own({ mode: 'public', idps: [] }));
    renderDrawer();
    await waitFor(() => expect(radio('protected')).toBeEnabled());

    await user.click(screen.getByText('Public'));
    await user.click(saveButton());
    expect(await screen.findByTestId('confirm-modal-message')).toHaveTextContent(
      'Anyone will be able to submit this form.',
    );
    await user.click(screen.getByTestId('confirm-modal-cancel'));
    await waitFor(() => expect(screen.queryByTestId('confirm-modal-message')).toBeNull());
    expect(mockSetSettings).not.toHaveBeenCalled();
    expect(radio('public')).toBeChecked();

    await user.click(saveButton());
    await user.click(await screen.findByTestId('confirm-modal-confirm'));
    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'audience', {
        inherit: false,
        values: { mode: 'public', idps: [] },
        version: 1,
      }),
    );
  });

  // Inheriting a Public workspace opens the form just as setting Public does.
  it('asks before the form inherits a Public workspace', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(
      own({ mode: 'members', idps: [] }, { mode: 'public', idps: [] }),
    );
    mockSetSettings.mockResolvedValue(inherited({ mode: 'public', idps: [] }));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());

    await user.click(screen.getByText(INHERIT));
    await user.click(saveButton());
    await user.click(await screen.findByTestId('confirm-modal-confirm'));

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'audience', {
        inherit: true,
        version: 1,
      }),
    );
  });

  it('saves without asking when the form is already public', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(inherited({ mode: 'public', idps: [] }));
    mockSetSettings.mockResolvedValue(own({ mode: 'public', idps: [] }));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());

    await user.click(screen.getByText(INHERIT));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'audience', {
        inherit: false,
        values: { mode: 'public', idps: [] },
        version: 1,
      }),
    );
    expect(screen.queryByTestId('confirm-modal-message')).toBeNull();
  });

  // Someone else saved first: their change is read back and the stale edit is dropped.
  it('reloads and says so when someone else saved first', async () => {
    const user = userEvent.setup();
    mockGetSettings
      .mockResolvedValueOnce(own({ mode: 'members', idps: [] }))
      .mockResolvedValue({ ...own(IDIR), version: 2 });
    mockSetSettings.mockRejectedValue(new ApiError('changed', 409));
    renderDrawer();
    await waitFor(() => expect(radio('members')).toBeEnabled());

    await user.click(screen.getByText('Protected'));
    await user.click(screen.getByText('BCeID Business'));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'error', text: CONFLICT }),
    );
    await waitFor(() => expect(login('azureidir')).toBeChecked());
    expect(login('bceidbusiness')).not.toBeChecked();
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
  });

  it('keeps the edit and reports a failed save', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own({ mode: 'public', idps: [] }));
    mockSetSettings.mockRejectedValue(new Error('boom'));
    renderDrawer();
    await waitFor(() => expect(radio('public')).toBeEnabled());

    await user.click(screen.getByText('Members only'));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'error', text: 'Save failed.' }),
    );
    expect(radio('members')).toBeChecked();
  });

  it('cancels an unsaved change', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own({ mode: 'public', idps: [] }));
    renderDrawer();
    await waitFor(() => expect(radio('public')).toBeEnabled());

    await user.click(screen.getByText('Members only'));
    await user.click(screen.getByTestId('form-settings-form-audience-cancel'));

    expect(radio('public')).toBeChecked();
    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  it('says when the audience cannot be read and saves nothing', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockRejectedValue(new ApiError('Boom', 500));
    renderDrawer();

    expect(await screen.findByTestId('form-settings-audience-error')).toHaveTextContent(
      'Could not load the form audience.',
    );
    expect(inheritBox()).toBeDisabled();
    await user.click(saveButton());
    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  // A protected audience cannot be shown or checked without the logins, so the drawer stays locked.
  it('says when the logins cannot be read and stays locked', async () => {
    mockGetSettings.mockResolvedValue(own({ mode: 'public', idps: [] }));
    mockGetProviders.mockRejectedValue(new ApiError('Boom', 500));
    renderDrawer();

    expect(await screen.findByTestId('form-settings-audience-error')).toBeInTheDocument();
    expect(radio('public')).toBeDisabled();
    expect(saveButton()).toBeDisabled();
  });
});
