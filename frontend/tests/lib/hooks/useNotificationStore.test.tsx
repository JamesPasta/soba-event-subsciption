import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import makeStore from '@/lib/store';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';

let store: ReturnType<typeof makeStore>;
let consoleError: MockInstance<typeof console.error>;

function wrapper({ children }: { children: React.ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}

// A real store, so Redux Toolkit's development checks run and report through console.error too.
describe('useNotificationStore addNotification', () => {
  beforeEach(() => {
    store = makeStore();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('logs the cause once and keeps it out of the store, across later dispatches', () => {
    const { result } = renderHook(() => useNotificationStore(), { wrapper });
    const cause = new Error('save failed');

    act(() => {
      result.current.addNotification({
        text: 'Could not save.',
        type: 'error',
        consoleError: cause,
      });
    });
    // Another dispatch while the error notification is still in state.
    act(() => {
      result.current.addNotification({ text: 'Saved.', type: 'success' });
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Could not save.', cause);
    expect(store.getState().notification.notifications).toStrictEqual([
      { id: expect.any(String), text: 'Could not save.', type: 'error' },
      { id: expect.any(String), text: 'Saved.', type: 'success' },
    ]);
  });

  it('logs nothing for a notification without a cause', () => {
    const { result } = renderHook(() => useNotificationStore(), { wrapper });

    act(() => {
      result.current.addNotification({ text: 'Saved.', type: 'success' });
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(store.getState().notification.notifications).toHaveLength(1);
  });
});
