import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import type { Dictionary } from '@/src/types/dictionary';
import type {
  FormAudienceSettings,
  FormReviewSettings,
  ReviewSettings,
} from '@/src/types/formSettings';
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
import ReviewSettingsDrawer from '@/src/features/form-settings/review/ReviewSettingsDrawer';

const STATUS_UPDATES = 'Reviewers can update the status of submissions';
const REVISION = 'Submitters can revise their own submissions';
const PUBLIC_NOTE = 'Only signed-in submitters can revise.';
const INHERIT = 'Use the workspace setting';
const CONFLICT = 'Someone else changed these settings.';

const mockDict = {
  form: {
    save: 'Save',
    settings: {
      reviewSettingsDrawerLabel: 'Review Settings',
      allowStatusUpdatesLabel: STATUS_UPDATES,
      allowSubmitterRevisionLabel: REVISION,
      allowSubmitterRevisionPublicNote: PUBLIC_NOTE,
      inheritWorkspaceLabel: INHERIT,
      reviewSettingsLoadError: 'load error',
      formSettingsDrawerSaveSuccessMessage: 'Changes saved.',
      formSettingsDrawerSaveErrorMessage: 'Save failed.',
      settingsConflictMessage: CONFLICT,
    },
  },
  general: {
    cancel: 'Cancel',
    noAccess: 'You do not have access to this.',
    sessionExpired: 'Your session has ended.',
  },
} as unknown as Dictionary;

const OFF: ReviewSettings = { allowStatusUpdates: false, allowSubmitterRevision: false };
const ON: ReviewSettings = { allowStatusUpdates: true, allowSubmitterRevision: true };

const audience = (mode: 'public' | 'protected'): FormAudienceSettings => {
  const effective =
    mode === 'public'
      ? { mode: 'public' as const, idps: [] }
      : { mode: 'protected' as const, idps: ['azureidir'] };
  return { inherit: true, own: null, workspace: effective, effective, version: 1 };
};

// The form's review settings while it inherits the workspace's.
const inherited = (workspace: ReviewSettings): FormReviewSettings => ({
  inherit: true,
  own: null,
  workspace,
  effective: workspace,
  version: 1,
});

// The form's own review settings, under a workspace that keeps review off.
const own = (values: ReviewSettings, version = 1): FormReviewSettings => ({
  inherit: false,
  own: values,
  workspace: OFF,
  effective: values,
  version,
});

let store: ReturnType<typeof makeStore>;

function renderDrawer() {
  return render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <ReviewSettingsDrawer dict={mockDict} drawerName="review-settings" formId="f1" />
      </SWRConfig>
    </Provider>,
  );
}

const input = (testId: string) =>
  screen.getByTestId(testId).querySelector('input') as HTMLInputElement;
const statusUpdates = () => input('form-settings-allow-status-updates');
const revision = () => input('form-settings-allow-submitter-revision');
const inheritBox = () => input('form-settings-review-inherit');
const saveButton = () => screen.getByTestId('form-settings-review-settings-save');

describe('ReviewSettingsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    mockGetAudience.mockResolvedValue(audience('protected'));
  });

  it('shows the workspace values read-only while the form inherits', async () => {
    mockGetSettings.mockResolvedValue(inherited({ ...OFF, allowStatusUpdates: true }));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());

    expect(inheritBox()).toBeChecked();
    expect(statusUpdates()).toBeChecked();
    expect(revision()).not.toBeChecked();
    expect(statusUpdates()).toBeDisabled();
    expect(revision()).toBeDisabled();
    expect(mockGetSettings).toHaveBeenCalledWith('token', 'f1', 'review');
  });

  it("saves the form's own values once inherit is turned off", async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(inherited(OFF));
    mockSetSettings.mockResolvedValue(own({ ...OFF, allowSubmitterRevision: true }, 2));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());

    await user.click(screen.getByText(INHERIT));
    expect(revision()).toBeEnabled();
    await user.click(screen.getByText(REVISION));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'review', {
        inherit: false,
        values: { allowStatusUpdates: false, allowSubmitterRevision: true },
        version: 1,
      }),
    );
    expect(mockAddNotification).toHaveBeenCalledWith({ type: 'success', text: 'Changes saved.' });
  });

  // Each checkbox changes its own flag; the save still carries both.
  it('keeps the other flag when one changes', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own(ON));
    mockSetSettings.mockResolvedValue(own({ ...ON, allowStatusUpdates: false }, 2));
    renderDrawer();
    await waitFor(() => expect(statusUpdates()).toBeEnabled());

    await user.click(screen.getByText(STATUS_UPDATES));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'review', {
        inherit: false,
        values: { allowStatusUpdates: false, allowSubmitterRevision: true },
        version: 1,
      }),
    );
  });

  it('goes back to the workspace values and saves inherit only', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own(ON));
    mockSetSettings.mockResolvedValue(inherited(OFF));
    renderDrawer();
    await waitFor(() => expect(inheritBox()).toBeEnabled());

    await user.click(screen.getByText(INHERIT));
    expect(statusUpdates()).not.toBeChecked();
    expect(statusUpdates()).toBeDisabled();
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockSetSettings).toHaveBeenCalledWith('token', 'f1', 'review', {
        inherit: true,
        version: 1,
      }),
    );
  });

  // A save with nothing changed would still move the version on and stale someone else's edit.
  it('keeps Save off until something changes, and Cancel drops the change', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own(OFF));
    renderDrawer();
    await waitFor(() => expect(statusUpdates()).toBeEnabled());

    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByText(STATUS_UPDATES));
    expect(saveButton()).toBeEnabled();
    await user.click(screen.getByTestId('form-settings-review-settings-cancel'));

    expect(statusUpdates()).not.toBeChecked();
    expect(mockSetSettings).not.toHaveBeenCalled();
  });

  it('keeps the edit and reports a failed save', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own(OFF));
    mockSetSettings.mockRejectedValue(new ApiError('Boom', 500));
    renderDrawer();
    await waitFor(() => expect(statusUpdates()).toBeEnabled());

    await user.click(screen.getByText(STATUS_UPDATES));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'error', text: 'Save failed.' }),
    );
    expect(statusUpdates()).toBeChecked();
  });

  it('drops a stale edit when someone else saved first', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own(OFF));
    mockSetSettings.mockRejectedValue(new ApiError('Changed', 409));
    renderDrawer();
    await waitFor(() => expect(statusUpdates()).toBeEnabled());

    await user.click(screen.getByText(STATUS_UPDATES));
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({ type: 'error', text: CONFLICT }),
    );
    expect(statusUpdates()).not.toBeChecked();
  });

  it('sends one save when Save is pressed twice', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(own(OFF));
    mockSetSettings.mockImplementation(() => new Promise(() => {}));
    renderDrawer();
    await waitFor(() => expect(statusUpdates()).toBeEnabled());

    await user.click(screen.getByText(STATUS_UPDATES));
    await user.click(saveButton());
    await user.click(saveButton());

    expect(mockSetSettings).toHaveBeenCalledTimes(1);
  });

  // Signed-in owners can still revise on a Public form, so the note informs without locking.
  it('notes on a Public audience that anonymous submissions cannot be revised', async () => {
    mockGetSettings.mockResolvedValue(own(OFF));
    mockGetAudience.mockResolvedValue(audience('public'));
    renderDrawer();

    expect(
      await screen.findByTestId('form-settings-allow-submitter-revision-public-note'),
    ).toHaveTextContent(PUBLIC_NOTE);
    expect(revision()).toBeEnabled();
    const describedBy = screen
      .getByTestId('form-settings-allow-submitter-revision')
      .querySelector('[aria-describedby]')
      ?.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(PUBLIC_NOTE);
  });

  it('says when the settings cannot be read and saves nothing', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockRejectedValue(new ApiError('Boom', 500));
    renderDrawer();

    expect(await screen.findByTestId('form-settings-review-settings-error')).toHaveTextContent(
      'load error',
    );
    expect(statusUpdates()).toBeDisabled();
    expect(inheritBox()).toBeDisabled();
    await user.click(saveButton());
    expect(mockSetSettings).not.toHaveBeenCalled();
  });
});
