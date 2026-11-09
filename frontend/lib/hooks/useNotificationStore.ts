'use client';

import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import {
  addNotification,
  removeNotification,
  clearNotifications,
} from '../slices/notificationSlice';
import type { NotificationType } from '../slices/notificationSlice';

export interface AddNotificationPayload {
  text: string;
  type?: NotificationType;
  consoleError?: unknown;
}

export function useNotificationStore() {
  const dispatch = useAppDispatch();
  const notifications = useAppSelector((state) => state.notification.notifications);

  // Memoized so callers can safely list these in effect dependency arrays.
  const add = useCallback(
    ({ consoleError, ...notification }: AddNotificationPayload) => {
      if (consoleError) {
        // The single sanctioned logging sink (see no-console rule). The cause is logged, never stored.
        // eslint-disable-next-line no-console
        console.error(notification.text, consoleError);
      }
      return dispatch(addNotification(notification));
    },
    [dispatch],
  );
  const remove = useCallback((id: string) => dispatch(removeNotification(id)), [dispatch]);
  const clear = useCallback(() => dispatch(clearNotifications()), [dispatch]);

  return {
    notifications,
    addNotification: add,
    removeNotification: remove,
    clearNotifications: clear,
  };
}
