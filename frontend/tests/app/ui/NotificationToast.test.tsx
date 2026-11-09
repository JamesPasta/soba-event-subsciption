import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import makeStore from '@/lib/store';
import { addNotification } from '@/lib/slices/notificationSlice';
import { NotificationToast } from '@/app/ui/base/NotificationToast';

const renderToast = (type: 'info' | 'error', text: string) => {
  const store = makeStore();
  store.dispatch(addNotification({ text, type }));
  render(
    <Provider store={store}>
      <NotificationToast />
    </Provider>,
  );
};

describe('NotificationToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces an error as an alert and keeps it until it is closed', () => {
    renderToast('error', 'Print failed.');
    expect(screen.getByRole('alert').textContent).toContain('Print failed.');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Print failed.')).toBeTruthy();
  });

  it('announces other notices as a status and dismisses them on their own', () => {
    renderToast('info', 'Saved.');
    expect(screen.getByRole('status').textContent).toContain('Saved.');
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('Saved.')).toBeNull();
  });
});
