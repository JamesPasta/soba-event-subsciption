import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import type { PostSubmissionActionValues } from '@/src/types/postSubmission';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const { mockGetSettings, mockSetSettings, mockAddNotification } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockSetSettings: vi.fn(),
  mockAddNotification: vi.fn(),
}));

vi.mock('@/src/features/form-settings/data/api', () => ({
  getWorkspaceSettings: mockGetSettings,
  setWorkspaceSettings: mockSetSettings,
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import WorkspaceActionDrawer from '@/src/features/post-submission/ui/WorkspaceActionDrawer';
import { emailAddressesAction } from '@/src/features/post-submission/actions/email';

const dict: Dictionary = en;
const t = en.postSubmission.email;
const CODE = 'post-submission-email-addresses';

const saved = (values: PostSubmissionActionValues, version = 1) => ({ values, version });

let store: ReturnType<typeof makeStore>;

function renderDrawer() {
  return render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <WorkspaceActionDrawer
          dict={dict}
          workspaceId="ws1"
          code={CODE}
          ui={emailAddressesAction}
        />
      </SWRConfig>
    </Provider>,
  );
}

const input = () =>
  screen.getByTestId('post-submission-email-input').querySelector('input') as HTMLInputElement;
const enabledBox = () =>
  screen.getByTestId('post-submission-email-enabled').querySelector('input') as HTMLInputElement;
const saveButton = () => screen.getByTestId(`form-settings-${CODE}-save`);
const list = () => screen.getByTestId('post-submission-email-list');
const chips = () =>
  within(list())
    .queryAllByTestId('post-submission-email-chip')
    .map((chip) => chip.textContent);
const savedBody = () => mockSetSettings.mock.calls[0][3];
// The design system labels the button in English and also points it at its chip.
const removeButton = (address: string) =>
  list().querySelector(`button[aria-label="Remove ${address}"]`) as HTMLButtonElement;

async function loaded(values: PostSubmissionActionValues = { enabled: false, options: {} }) {
  mockGetSettings.mockResolvedValue(saved(values));
  renderDrawer();
  await waitFor(() => expect(input()).toBeEnabled());
}

describe('WorkspaceActionDrawer with the email action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    mockSetSettings.mockImplementation((_token, _ws, _key, body) => Promise.resolve(body));
  });

  it("reads the action's settings under its own key", async () => {
    await loaded({ enabled: true, options: { to: ['team@example.com'] } });
    expect(mockGetSettings).toHaveBeenCalledWith('token', 'ws1', `post-submission/${CODE}`);
    expect(chips()).toEqual(['team@example.com']);
    expect(list()).toHaveTextContent('Addresses: 1 / 100');
    expect(enabledBox()).toBeChecked();
  });

  it('adds what is typed on Enter without saving the drawer', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.type(input(), 'Jane@Gov.BC.ca{Enter}');

    expect(chips()).toEqual(['jane@gov.bc.ca']);
    expect(input()).toHaveValue('');
    expect(mockSetSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('post-submission-email-status')).toHaveTextContent(
      'Added: jane@gov.bc.ca',
    );
  });

  it('adds on a comma, and every address in a list pasted from Outlook', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.type(input(), 'a@example.com,');
    await user.paste('"Smith, Jane" <jane@gov.bc.ca>; "Doe, John" <john@gov.bc.ca>');

    expect(chips()).toEqual(['a@example.com', 'jane@gov.bc.ca', 'john@gov.bc.ca']);
  });

  it('ignores an address already on the list, whatever its case, and says so', async () => {
    const user = userEvent.setup();
    await loaded({ enabled: true, options: { to: ['team@example.com'] } });
    await user.type(input(), 'TEAM@example.com{Enter}');

    expect(chips()).toEqual(['team@example.com']);
    expect(screen.getByTestId('post-submission-email-duplicates')).toHaveTextContent(
      'Already on the list: team@example.com',
    );
  });

  it('keeps text that is not an address in the field, with a message, and blocks the save', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(enabledBox());
    await user.type(input(), 'ok@example.com jane{Enter}');

    expect(chips()).toEqual(['ok@example.com']);
    expect(input()).toHaveValue('jane');
    expect(screen.getByTestId('post-submission-email-input')).toHaveTextContent(t.invalid);
    expect(saveButton()).toBeDisabled();

    // Fixing the text lets it through again.
    await user.clear(input());
    await user.type(input(), 'jane@example.com{Enter}');
    expect(saveButton()).toBeEnabled();
  });

  it('adds text still in the field when Save is pressed', async () => {
    const user = userEvent.setup();
    await loaded({ enabled: true, options: { to: ['team@example.com'] } });
    await user.type(input(), 'late@example.com');
    // Save is ready before the click, so the click that leaves the field also saves.
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());

    await waitFor(() => expect(mockSetSettings).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({
      values: { enabled: true, options: { to: ['team@example.com', 'late@example.com'] } },
      version: 1,
    });
  });

  it('keeps typed text in the field on leaving it, so nothing moves before Save', async () => {
    const user = userEvent.setup();
    await loaded({ enabled: true, options: { to: ['team@example.com'] } });
    await user.type(input(), 'late@example.com');
    await user.tab();

    expect(input()).toHaveValue('late@example.com');
    expect(chips()).toEqual(['team@example.com']);
    expect(saveButton()).toBeEnabled();
  });

  it('stops at Save, saving nothing, when the text in the field is not an address', async () => {
    const user = userEvent.setup();
    await loaded({ enabled: true, options: { to: ['team@example.com'] } });
    await user.type(input(), 'jane');
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());

    expect(mockSetSettings).not.toHaveBeenCalled();
    expect(input()).toHaveValue('jane');
    expect(screen.getByTestId('post-submission-email-input')).toHaveTextContent(t.invalid);
    expect(saveButton()).toBeDisabled();
  });

  it('saves a first address typed after turning the emails on, in one click', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(enabledBox());
    expect(saveButton()).toBeDisabled();

    await user.type(input(), 'first@example.com');
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());

    await waitFor(() => expect(mockSetSettings).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({
      values: { enabled: true, options: { to: ['first@example.com'] } },
      version: 1,
    });
  });

  it('keeps a pasted entry that is not an address, beside named ones', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(input());
    await user.paste('Jane <jane@gov.bc.ca>, bob.gov.bc.ca');

    expect(chips()).toEqual(['jane@gov.bc.ca']);
    expect(input()).toHaveValue('bob.gov.bc.ca');
    expect(screen.getByTestId('post-submission-email-input')).toHaveTextContent(t.invalid);
  });

  it('keeps the rest in the field past 100 addresses', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 99 }, (_, index) => `a${index}@example.com`);
    await loaded({ enabled: true, options: { to: many } });
    await user.click(input());
    await user.paste('b@example.com; c@example.com');

    expect(chips()).toHaveLength(100);
    expect(input()).toHaveValue('c@example.com');
    expect(screen.getByTestId('post-submission-email-input')).toHaveTextContent(
      t.tooMany.replace('{max}', '100'),
    );
  });

  it('removes a chip and returns focus to the field when the list empties', async () => {
    const user = userEvent.setup();
    await loaded({ enabled: false, options: { to: ['team@example.com'] } });
    await user.click(removeButton('team@example.com'));

    expect(chips()).toEqual([]);
    expect(list()).toHaveTextContent(t.none);
    expect(input()).toHaveFocus();
  });

  it('saves an emptied list as no options', async () => {
    const user = userEvent.setup();
    await loaded({ enabled: false, options: { to: ['team@example.com'] } });
    await user.click(removeButton('team@example.com'));
    await user.click(saveButton());

    await waitFor(() => expect(mockSetSettings).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({ values: { enabled: false, options: {} }, version: 1 });
  });

  it('will not save the emails on with no address, and says so aloud', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(enabledBox());

    expect(list()).toHaveTextContent(t.required);
    expect(screen.getByTestId('post-submission-email-status')).toHaveTextContent(t.required);
    expect(saveButton()).toBeDisabled();
  });

  it('says so aloud when removing the last address leaves the emails on with nobody', async () => {
    const user = userEvent.setup();
    await loaded({ enabled: true, options: { to: ['team@example.com'] } });
    await user.click(removeButton('team@example.com'));

    expect(screen.getByTestId('post-submission-email-status')).toHaveTextContent(
      `Removed: team@example.com ${t.required}`,
    );
  });

  it('reloads and says so when someone else saved first', async () => {
    const user = userEvent.setup();
    await loaded();
    mockSetSettings.mockRejectedValueOnce(new ApiError('Conflict', 409));
    mockGetSettings.mockResolvedValue(
      saved({ enabled: true, options: { to: ['theirs@example.com'] } }, 2),
    );
    await user.type(input(), 'mine@example.com{Enter}');
    await user.click(saveButton());

    await waitFor(() => expect(chips()).toEqual(['theirs@example.com']));
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: en.form.settings.settingsConflictMessage }),
    );
  });

  it("says the settings were not accepted on a 400, keeping the server's words out of the page", async () => {
    const user = userEvent.setup();
    await loaded();
    const refusal = new ApiError('Invalid options for post-submission-email-addresses: to.0', 400);
    mockSetSettings.mockRejectedValueOnce(refusal);
    await user.type(input(), 'mine@example.com{Enter}');
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({
        type: 'error',
        text: en.postSubmission.notAccepted,
        consoleError: refusal,
      }),
    );
    expect(chips()).toEqual(['mine@example.com']);
  });
});
