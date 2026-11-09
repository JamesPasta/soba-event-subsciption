import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig, useSWRConfig } from 'swr';
import type { Dictionary } from '@/src/types/dictionary';
import type { FormAudienceSettings, FormSubmitterSettings } from '@/src/types/formSettings';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const { mockGetSettings, mockSetSettings, mockGetAudience, mockAddNotification } = vi.hoisted(
  () => ({
    mockGetSettings: vi.fn(),
    mockSetSettings: vi.fn(),
    mockGetAudience: vi.fn(),
    mockAddNotification: vi.fn(),
  }),
);

// The drawer reads two settings groups through one API: its own and the form audience.
vi.mock('@/src/features/form-settings/data/api', () => ({
  getFormSettings: (token: string, formId: string, key: string) =>
    key === 'audience' ? mockGetAudience(token, formId) : mockGetSettings(token, formId, key),
  setFormSettings: mockSetSettings,
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import SubmitterSettingsDrawer from '@/src/features/form-settings/submitter/SubmitterSettingsDrawer';

const LABEL = 'Allow Submitters to Save and Edit Drafts';
const PUBLIC_NOTE = 'Drafts are not available for Public forms.';
const INHERIT = 'Use the workspace setting';

const mockDict = {
  form: {
    save: 'Save',
    settings: {
      submitterSettingsDrawerLabel: 'Submitter Settings',
      allowSubmitterDraftsLabel: LABEL,
      allowSubmitterDraftsPublicNote: PUBLIC_NOTE,
      inheritWorkspaceLabel: INHERIT,
      submitterSettingsLoadError: 'load error',
      formSettingsDrawerSaveSuccessMessage: 'Changes saved.',
      formSettingsDrawerSaveErrorMessage: 'Save failed.',
    },
  },
  general: {
    cancel: 'Cancel',
    noAccess: 'You do not have access to this.',
    sessionExpired: 'Your session has ended.',
  },
} as unknown as Dictionary;

const AUDIENCES: Record<'public' | 'protected', FormAudienceSettings['effective']> = {
  public: { mode: 'public', idps: [] },
  protected: { mode: 'protected', idps: ['azureidir'] },
};

// The form's audience settings, as the endpoint returns them while the form inherits.
const audience = (mode: keyof typeof AUDIENCES): FormAudienceSettings => ({
  inherit: true,
  own: null,
  workspace: AUDIENCES[mode],
  effective: AUDIENCES[mode],
  version: 1,
});

// The form's submitter settings while it inherits the workspace's drafts flag.
const inheritedDrafts = (allowSubmitterDrafts: boolean): FormSubmitterSettings => ({
  inherit: true,
  own: null,
  workspace: { allowSubmitterDrafts },
  effective: { allowSubmitterDrafts },
  version: 1,
});

// The form's own drafts flag, under a workspace that keeps drafts off.
const ownDrafts = (allowSubmitterDrafts: boolean): FormSubmitterSettings => ({
  inherit: false,
  own: { allowSubmitterDrafts },
  workspace: { allowSubmitterDrafts: false },
  effective: { allowSubmitterDrafts },
  version: 1,
});

let store: ReturnType<typeof makeStore>;

// Stands in for a later read that finds the audience has become Public.
function MakeAudiencePublic() {
  const { mutate } = useSWRConfig();
  return (
    <button
      type="button"
      data-testid="make-audience-public"
      onClick={() =>
        mutate(['form-settings', 'audience', 'f1'], audience('public'), { revalidate: false })
      }
    >
      make public
    </button>
  );
}

function renderDrawer() {
  return render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <MakeAudiencePublic />
        <SubmitterSettingsDrawer dict={mockDict} drawerName="submitter-settings" formId="f1" />
      </SWRConfig>
    </Provider>,
  );
}

const checkbox = () =>
  screen.getByTestId('form-settings-allow-drafts').querySelector('input') as HTMLInputElement;
const saveButton = () => screen.getByTestId('form-settings-submitter-settings-save');
const inheritBox = () =>
  screen.getByTestId('form-settings-submitter-inherit').querySelector('input') as HTMLInputElement;

describe('SubmitterSettingsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    mockGetAudience.mockResolvedValue(audience('protected'));
  });

  it('shows the workspace value read-only while the form inherits', async () => {
    mockGetSettings.mockResolvedValue(inheritedDrafts(true));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());
    expect(inheritBox()).toBeChecked();
    expect(checkbox()).toBeChecked();
    expect(checkbox()).toBeDisabled();
  });

  it("saves the form's own value once inherit is turned off", async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(inheritedDrafts(true));
    mockSetSettings.mockResolvedValue(ownDrafts(false));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());

    await user.click(screen.getByText(INHERIT));
    expect(checkbox()).toBeEnabled();
    expect(checkbox()).toBeChecked();
    await user.click(screen.getByText(LABEL));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'submitter', {
        inherit: false,
        values: { allowSubmitterDrafts: false },
        version: 1,
      }),
    );
  });

  it('goes back to the workspace value and saves inherit only', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(ownDrafts(true));
    mockSetSettings.mockResolvedValue(inheritedDrafts(false));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());
    expect(inheritBox()).not.toBeChecked();

    await user.click(screen.getByText(INHERIT));
    expect(checkbox()).not.toBeChecked();
    expect(checkbox()).toBeDisabled();
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'submitter', {
        inherit: true,
        version: 1,
      }),
    );
  });

  it('shows the saved setting', async () => {
    mockGetSettings.mockResolvedValue(ownDrafts(true));
    renderDrawer();
    await waitFor(() => expect(checkbox()).toBeEnabled());
    expect(checkbox()).toBeChecked();
    expect(mockGetSettings).toHaveBeenCalledWith('token', 'f1', 'submitter');
  });

  // A save with nothing changed would still move the version on and stale someone else's edit.
  it('keeps Save off until something changes', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(ownDrafts(false));
    renderDrawer();
    await waitFor(() => expect(checkbox()).toBeEnabled());

    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByText(LABEL));
    expect(saveButton()).toBeEnabled();
  });

  it('saves the changed setting', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(ownDrafts(false));
    mockSetSettings.mockResolvedValue({
      inherit: false,
      own: { allowSubmitterDrafts: true },
      workspace: { allowSubmitterDrafts: false },
      effective: { allowSubmitterDrafts: true },
      version: 2,
    });
    renderDrawer();
    await waitFor(() => expect(checkbox()).toBeEnabled());

    await user.click(screen.getByText(LABEL));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'success', text: 'Changes saved.' }),
    );
    expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'submitter', {
      inherit: false,
      values: { allowSubmitterDrafts: true },
      version: 1,
    });
    expect(checkbox()).toBeChecked();
  });

  it('keeps the edit and reports a failed save', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(ownDrafts(false));
    mockSetSettings.mockRejectedValue(new Error('boom'));
    renderDrawer();
    await waitFor(() => expect(checkbox()).toBeEnabled());

    await user.click(screen.getByText(LABEL));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'error', text: 'Save failed.' }),
    );
    expect(checkbox()).toBeChecked();
  });

  it('sends one save when Save is pressed twice', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(ownDrafts(false));
    mockSetSettings.mockImplementation(() => new Promise(() => {}));
    renderDrawer();
    await waitFor(() => expect(checkbox()).toBeEnabled());

    await user.click(screen.getByText(LABEL));
    await user.click(saveButton());
    await user.click(saveButton());

    expect(mockSetSettings).toHaveBeenCalledTimes(1);
  });

  it('cancels an unsaved change', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(ownDrafts(false));
    renderDrawer();
    await waitFor(() => expect(checkbox()).toBeEnabled());

    await user.click(screen.getByText(LABEL));
    expect(checkbox()).toBeChecked();
    await user.click(screen.getByTestId('form-settings-submitter-settings-cancel'));

    expect(checkbox()).not.toBeChecked();
    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  // Whether the audience is Public decides if the setting may change, so it stays locked until known.
  it('keeps the setting locked until the audience is known', async () => {
    mockGetSettings.mockResolvedValue(ownDrafts(true));
    mockGetAudience.mockImplementation(() => new Promise(() => {}));
    renderDrawer();

    await waitFor(() => expect(checkbox()).toBeChecked());
    expect(checkbox()).toBeDisabled();
  });

  it('disables the setting with a linked note on a Public audience', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(ownDrafts(true));
    mockGetAudience.mockResolvedValue(audience('public'));
    renderDrawer();

    await waitFor(() => expect(checkbox()).toBeChecked());
    expect(await screen.findByTestId('form-settings-allow-drafts-public-note')).toHaveTextContent(
      PUBLIC_NOTE,
    );
    expect(checkbox()).toBeDisabled();
    expect(inheritBox()).toBeDisabled();
    const describedBy = screen
      .getByTestId('form-settings-allow-drafts')
      .querySelector('[aria-describedby]')
      ?.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(PUBLIC_NOTE);

    await user.click(saveButton());
    expect(mockSetSettings).not.toHaveBeenCalled();
    expect(mockGetAudience).toHaveBeenCalledWith('token', 'f1');
  });

  it('drops an edit when the audience turns out to be Public', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(ownDrafts(false));
    renderDrawer();
    await waitFor(() => expect(checkbox()).toBeEnabled());

    await user.click(screen.getByText(LABEL));
    expect(checkbox()).toBeChecked();

    await user.click(screen.getByTestId('make-audience-public'));

    await waitFor(() => expect(checkbox()).not.toBeChecked());
    expect(checkbox()).toBeDisabled();
    await user.click(saveButton());
    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  it('says when the settings cannot be read and saves nothing', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockRejectedValue(new ApiError('Boom', 500));
    renderDrawer();

    expect(await screen.findByTestId('form-settings-submitter-settings-error')).toHaveTextContent(
      'load error',
    );
    expect(checkbox()).toBeDisabled();
    await user.click(saveButton());
    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  // Without the audience the Public lock cannot be judged, so a refused read keeps the setting locked.
  it('says when the audience cannot be read and stays locked', async () => {
    mockGetSettings.mockResolvedValue(ownDrafts(false));
    mockGetAudience.mockRejectedValue(new ApiError('Forbidden', 403));
    renderDrawer();

    expect(await screen.findByTestId('form-settings-submitter-settings-error')).toHaveTextContent(
      'You do not have access to this.',
    );
    expect(checkbox()).toBeDisabled();
  });
});
