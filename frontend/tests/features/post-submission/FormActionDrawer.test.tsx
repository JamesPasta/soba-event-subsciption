import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import type {
  PostSubmissionActionValues,
  PostSubmissionFormActionList,
  PostSubmissionFormActionSettings,
} from '@/src/types/postSubmission';

const { mockGetSettings, mockSetSettings, mockAddNotification } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockSetSettings: vi.fn(),
  mockAddNotification: vi.fn(),
}));

vi.mock('@/src/features/form-settings/data/api', () => ({
  getFormSettings: mockGetSettings,
  setFormSettings: mockSetSettings,
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import FormActionDrawer from '@/src/features/post-submission/ui/FormActionDrawer';
import { postSubmissionActionUi } from '@/src/features/post-submission/actions/registry';

const dict: Dictionary = en;
const EMAIL = 'post-submission-email-addresses';
const LOG = 'post-submission-log';
const OFF: PostSubmissionActionValues = { enabled: false, options: {} };
const TEAM: PostSubmissionActionValues = { enabled: true, options: { to: ['team@example.com'] } };

type Item = PostSubmissionFormActionList['actions'][number];

const item = (
  code: string,
  overrides: { scopes?: Item['scopes']; workspaceConfigurable?: boolean } = {},
): Item => ({
  code,
  name: code,
  scopes: overrides.scopes ?? ['workspace', 'form'],
  workspaceConfigurable: overrides.workspaceConfigurable ?? true,
  settings: { inherit: true, own: null, workspace: OFF, effective: OFF, version: 0 },
});

// A form that uses the workspace's values: the shape the server returns before its first save.
const inheriting = (workspace: PostSubmissionActionValues): PostSubmissionFormActionSettings => ({
  inherit: true,
  own: null,
  workspace,
  effective: workspace,
  version: 0,
});

let store: ReturnType<typeof makeStore>;

function renderDrawer(action: Item) {
  const ui = postSubmissionActionUi(action.code);
  if (!ui) throw new Error(`no fields for ${action.code}`);
  return render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <FormActionDrawer dict={dict} formId="f1" action={action} ui={ui} />
      </SWRConfig>
    </Provider>,
  );
}

const inputIn = (testId: string) =>
  screen.getByTestId(testId).querySelector('input') as HTMLInputElement;
const saveButton = (code: string) => screen.getByTestId(`form-settings-${code}-save`);
const savedBody = () => mockSetSettings.mock.calls[0][3];

describe('FormActionDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    mockSetSettings.mockImplementation((_token, _form, _key, body) =>
      Promise.resolve({ ...inheriting(TEAM), inherit: body.inherit, version: 1 }),
    );
  });

  it("shows the workspace's addresses read-only while the form uses them", async () => {
    mockGetSettings.mockResolvedValue(inheriting(TEAM));
    renderDrawer(item(EMAIL));

    await waitFor(() => expect(inputIn(`${EMAIL}-inherit`)).toBeChecked());
    expect(mockGetSettings).toHaveBeenCalledWith('token', 'f1', `post-submission/${EMAIL}`);
    expect(screen.getByTestId('post-submission-email-view-list')).toHaveTextContent(
      'team@example.com',
    );
    expect(screen.queryByTestId('post-submission-email-input')).not.toBeInTheDocument();
  });

  it("saves the form's own list once it stops using the workspace's", async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(inheriting(TEAM));
    renderDrawer(item(EMAIL));
    await waitFor(() => expect(inputIn(`${EMAIL}-inherit`)).toBeEnabled());

    await user.click(inputIn(`${EMAIL}-inherit`));
    await user.type(inputIn('post-submission-email-input'), 'form@example.com{Enter}');
    await user.click(saveButton(EMAIL));

    await waitFor(() => expect(mockSetSettings).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({
      inherit: false,
      values: { enabled: true, options: { to: ['team@example.com', 'form@example.com'] } },
      version: 0,
    });
  });

  it('saves a return to the workspace setting', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue({
      inherit: false,
      own: OFF,
      workspace: TEAM,
      effective: OFF,
      version: 3,
    });
    renderDrawer(item(EMAIL));
    await waitFor(() => expect(inputIn(`${EMAIL}-inherit`)).toBeEnabled());

    await user.click(inputIn(`${EMAIL}-inherit`));
    await user.click(saveButton(EMAIL));

    await waitFor(() => expect(mockSetSettings).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({ inherit: true, version: 3 });
  });

  it('lets Save work again after invalid text goes with a switch to the workspace setting', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(inheriting(TEAM));
    renderDrawer(item(EMAIL));
    await waitFor(() => expect(inputIn(`${EMAIL}-inherit`)).toBeEnabled());

    await user.click(inputIn(`${EMAIL}-inherit`));
    await user.type(inputIn('post-submission-email-input'), 'jane{Enter}');
    expect(saveButton(EMAIL)).toBeDisabled();
    // Back to the workspace setting: the fields, and the refused text with them, go.
    await user.click(inputIn(`${EMAIL}-inherit`));
    expect(saveButton(EMAIL)).toBeEnabled();

    await user.click(inputIn(`${EMAIL}-inherit`));
    expect(inputIn('post-submission-email-input')).toHaveValue('');
    expect(saveButton(EMAIL)).toBeEnabled();
  });

  it('edits the form alone when its workspace cannot set the action', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(inheriting(OFF));
    renderDrawer(item(EMAIL, { workspaceConfigurable: false }));
    await waitFor(() => expect(inputIn('post-submission-email-input')).toBeEnabled());

    expect(screen.queryByTestId(`${EMAIL}-inherit`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`${EMAIL}-form-only`)).toHaveTextContent(
      en.postSubmission.formOnlyNote,
    );
    await user.click(inputIn('post-submission-email-enabled'));
    await user.type(inputIn('post-submission-email-input'), 'form@example.com{Enter}');
    await user.click(saveButton(EMAIL));

    await waitFor(() => expect(mockSetSettings).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({
      inherit: false,
      values: { enabled: true, options: { to: ['form@example.com'] } },
      version: 0,
    });
  });

  it('says nothing is saved yet for a form set alone, and saves what it shows as its own', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(inheriting(OFF));
    renderDrawer(item(EMAIL, { workspaceConfigurable: false }));
    await waitFor(() => expect(saveButton(EMAIL)).toBeEnabled());

    expect(screen.getByTestId(`${EMAIL}-unsaved`)).toHaveTextContent(
      en.postSubmission.formOnlyUnsaved,
    );
    await user.click(saveButton(EMAIL));

    await waitFor(() => expect(mockSetSettings).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({ inherit: false, values: OFF, version: 0 });
  });

  it('waits for a change on a form set alone that has saved its own', async () => {
    mockGetSettings.mockResolvedValue({
      inherit: false,
      own: TEAM,
      workspace: OFF,
      effective: TEAM,
      version: 2,
    });
    renderDrawer(item(EMAIL, { workspaceConfigurable: false }));
    await waitFor(() => expect(inputIn('post-submission-email-input')).toBeEnabled());

    expect(screen.queryByTestId(`${EMAIL}-unsaved`)).not.toBeInTheDocument();
    expect(saveButton(EMAIL)).toBeDisabled();
  });

  it('shows an action set for the workspace only read-only, with nothing to save', async () => {
    mockGetSettings.mockResolvedValue(inheriting(TEAM));
    renderDrawer(item(EMAIL, { scopes: ['workspace'] }));

    await waitFor(() =>
      expect(screen.getByTestId('post-submission-email-view-list')).toHaveTextContent(
        'team@example.com',
      ),
    );
    expect(screen.getByTestId(`${EMAIL}-workspace-only`)).toHaveTextContent(
      en.postSubmission.workspaceOnlyNote,
    );
    expect(screen.queryByTestId(`form-settings-${EMAIL}-save`)).not.toBeInTheDocument();
  });

  it("saves the log action's note, trimmed", async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue(inheriting(OFF));
    renderDrawer(item(LOG));
    await waitFor(() => expect(inputIn(`${LOG}-inherit`)).toBeEnabled());

    await user.click(inputIn(`${LOG}-inherit`));
    await user.click(inputIn('post-submission-log-enabled'));
    await user.type(inputIn('post-submission-log-note'), ' smoke ');
    await user.click(saveButton(LOG));

    await waitFor(() => expect(mockSetSettings).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({
      inherit: false,
      values: { enabled: true, options: { note: 'smoke' } },
      version: 0,
    });
  });

  it('says why the settings did not load', async () => {
    mockGetSettings.mockRejectedValue(new Error('down'));
    renderDrawer(item(EMAIL));

    expect(await screen.findByTestId(`${EMAIL}-error`)).toHaveTextContent(
      en.postSubmission.settingsLoadError,
    );
  });
});
