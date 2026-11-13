import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import type { Dictionary } from '@/src/types/dictionary';
import type { EventSubscriptionSettings } from '@/src/types/formSettings';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const { getSettings, setSettings, revealToken, addNotification } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  revealToken: vi.fn(),
  addNotification: vi.fn(),
}));

vi.mock('@/src/features/form-settings/data/api', () => ({
  getFormSettings: getSettings,
  setFormSettings: setSettings,
  revealFormEventSubscriptionToken: revealToken,
}));
vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification }),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setIdTokenParsed, setToken } from '@/lib/slices/keycloakSlice';
import EventSubscription from '@/src/features/form-settings/event-subscription/EventSubscription';

const dict = {
  form: {
    save: 'Save',
    settings: {
      eventSubscriptionDrawerLabel: 'Event Subscription',
      eventSubscriptionEndpointUrl: 'Endpoint URL',
      eventSubscriptionEndpointExample: 'For example: https://endpoint.gov.bc.ca/api/v1/',
      eventSubscriptionKey: 'Key',
      eventSubscriptionToken: 'Endpoint Token',
      eventSubscriptionShowSecret: 'Show Secret',
      eventSubscriptionHideSecret: 'Hide Secret',
      eventSubscriptionRevealError: 'Could not reveal token.',
      eventSubscriptionLoadError: 'Could not load settings.',
      eventSubscriptionTokenUnavailable: 'Token storage is not configured.',
      formSettingsDrawerSaveSuccessMessage: 'Saved.',
      formSettingsDrawerSaveErrorMessage: 'Save failed.',
      settingsConflictMessage: 'Settings changed.',
    },
  },
  general: {
    cancel: 'Cancel',
    noAccess: 'No access.',
    sessionExpired: 'Session expired.',
  },
} as unknown as Dictionary;

const saved: EventSubscriptionSettings = {
  endpointUrl: 'https://example.test/events',
  key: 'events',
  hasToken: true,
  version: 2,
  updatedAt: '2025-07-18T00:00:00.000Z',
  updatedBy: 'Tester',
};

function renderDrawer() {
  const store = makeStore();
  store.dispatch(setToken('auth-token'));
  store.dispatch(setAuthenticated(true));
  const view = render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <EventSubscription dict={dict} drawerName="event-subscription" formId="f1" />
      </SWRConfig>
    </Provider>,
  );
  return { ...view, store };
}

describe('EventSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue(saved);
    revealToken.mockResolvedValue('stored-secret');
  });

  it('loads the saved token into the masked field when the page loads', async () => {
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByTestId('form-settings-event-subscription-save')).toBeDisabled(),
    );
    expect(screen.getByText('Event Subscription')).toBeInTheDocument();
    expect(screen.queryByText(/Updated:/)).not.toBeInTheDocument();
    expect(screen.getByTestId('event-subscription-url').querySelector('input')).toHaveValue(
      saved.endpointUrl,
    );
    expect(screen.getByTestId('event-subscription-key').querySelector('input')).toHaveValue(
      saved.key,
    );
    expect(screen.getByTestId('event-subscription-key').parentElement).toHaveClass('w-100');
    await waitFor(() =>
      expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveValue(
        'stored-secret',
      ),
    );
    expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.queryByText(/A token is saved/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Remove saved token/)).not.toBeInTheDocument();
    expect(getSettings).toHaveBeenCalledWith('auth-token', 'f1', 'event-subscription');
    expect(revealToken).toHaveBeenCalledWith('auth-token', 'f1');
  });

  it('shows a saved token on demand, then masks it when hidden', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Event Subscription' }));
    await waitFor(() =>
      expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveValue(
        'stored-secret',
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Show Secret' }));
    await waitFor(() =>
      expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveValue(
        'stored-secret',
      ),
    );
    expect(revealToken).toHaveBeenCalledWith('auth-token', 'f1');
    expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveAttribute(
      'type',
      'text',
    );
    expect(screen.getByTestId('form-settings-event-subscription-save')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Hide Secret' }));
    expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveValue(
      'stored-secret',
    );
    expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('saves a replacement token and keeps it masked in the field after save', async () => {
    const user = userEvent.setup();
    setSettings.mockResolvedValue({ ...saved, version: 3 });
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Event Subscription' }));
    await waitFor(() =>
      expect(screen.getByTestId('event-subscription-token').querySelector('input')).toBeEnabled(),
    );
    await user.clear(screen.getByTestId('event-subscription-token').querySelector('input')!);
    await user.type(
      screen.getByTestId('event-subscription-token').querySelector('input')!,
      'new-secret',
    );
    await user.click(screen.getByRole('button', { name: 'Show Secret' }));
    expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveAttribute(
      'type',
      'text',
    );
    await user.click(screen.getByTestId('form-settings-event-subscription-save'));
    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith('auth-token', 'f1', 'event-subscription', {
        endpointUrl: saved.endpointUrl,
        key: saved.key,
        version: 2,
        token: 'new-secret',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveValue(
        'new-secret',
      ),
    );
    expect(screen.getByTestId('event-subscription-token').querySelector('input')).toHaveAttribute(
      'type',
      'password',
    );
    expect(addNotification).toHaveBeenCalledWith({ type: 'success', text: 'Saved.' });
  });

  it('does not send an invalid endpoint URL', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Event Subscription' }));
    const field = screen.getByTestId('event-subscription-url').querySelector('input')!;
    await user.clear(field);
    await user.type(field, 'file:///secret');
    await user.click(screen.getByTestId('form-settings-event-subscription-save'));
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('keeps unsaved edits when the access token rotates', async () => {
    const user = userEvent.setup();
    const { store } = renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Event Subscription' }));
    const field = screen.getByTestId('event-subscription-url').querySelector('input')!;
    await waitFor(() => expect(field).toHaveValue(saved.endpointUrl));
    await user.clear(field);
    await user.type(field, 'https://example.test/updated');

    act(() => {
      store.dispatch(setToken('rotated-token'));
    });

    expect(screen.getByTestId('event-subscription-url').querySelector('input')).toHaveValue(
      'https://example.test/updated',
    );
    await user.click(screen.getByTestId('form-settings-event-subscription-save'));
    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith(
        'rotated-token',
        'f1',
        'event-subscription',
        expect.objectContaining({ endpointUrl: 'https://example.test/updated' }),
      ),
    );
  });

  it('discards unsaved edits when the authenticated user changes', async () => {
    const user = userEvent.setup();
    const { store } = renderDrawer();
    act(() => {
      store.dispatch(setIdTokenParsed({ sub: 'first-user' }));
    });
    await user.click(screen.getByRole('button', { name: 'Event Subscription' }));
    const field = screen.getByTestId('event-subscription-url').querySelector('input')!;
    await waitFor(() => expect(field).toHaveValue(saved.endpointUrl));
    await user.clear(field);
    await user.type(field, 'https://example.test/unsaved');

    act(() => {
      store.dispatch(setIdTokenParsed({ sub: 'second-user' }));
    });

    await waitFor(() =>
      expect(screen.getByTestId('event-subscription-url').querySelector('input')).toHaveValue(
        saved.endpointUrl,
      ),
    );
  });

  it('explains when token storage has not been configured', async () => {
    const user = userEvent.setup();
    setSettings.mockRejectedValue(new ApiError('Endpoint token storage is not configured', 503));
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Event Subscription' }));
    await waitFor(() =>
      expect(screen.getByTestId('event-subscription-token').querySelector('input')).toBeEnabled(),
    );
    await user.clear(screen.getByTestId('event-subscription-token').querySelector('input')!);
    await user.type(
      screen.getByTestId('event-subscription-token').querySelector('input')!,
      'new-secret',
    );
    await user.click(screen.getByTestId('form-settings-event-subscription-save'));
    await waitFor(() =>
      expect(addNotification).toHaveBeenCalledWith({
        type: 'error',
        text: 'Token storage is not configured.',
      }),
    );
  });
});
