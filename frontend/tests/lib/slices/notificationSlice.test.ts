import { describe, it, expect, beforeEach } from 'vitest';
import reducer, {
  addNotification,
  removeNotification,
  clearNotifications,
  type NotificationState,
} from '@/lib/slices/notificationSlice';

const emptyState: NotificationState = { notifications: [] };

describe('notificationSlice', () => {
  describe('addNotification', () => {
    it('adds a notification with auto-assigned string id', () => {
      const state = reducer(emptyState, addNotification({ text: 'Hello', type: 'info' }));
      expect(state.notifications).toHaveLength(1);
      expect(state.notifications[0].text).toBe('Hello');
      expect(state.notifications[0].type).toBe('info');
      expect(typeof state.notifications[0].id).toBe('string');
    });

    it('assigns incrementing ids across multiple additions', () => {
      let state = reducer(emptyState, addNotification({ text: 'First' }));
      state = reducer(state, addNotification({ text: 'Second' }));
      const [first, second] = state.notifications;
      expect(Number(second.id)).toBeGreaterThan(Number(first.id));
    });

    it('accumulates multiple notifications', () => {
      let state = reducer(emptyState, addNotification({ text: 'A', type: 'success' }));
      state = reducer(state, addNotification({ text: 'B', type: 'error' }));
      state = reducer(state, addNotification({ text: 'C', type: 'warning' }));
      expect(state.notifications).toHaveLength(3);
    });

    it('mints the id with the action, so replaying an action stores the same id', () => {
      const action = addNotification({ text: 'Once' });
      expect(reducer(emptyState, action)).toEqual(reducer(emptyState, action));
    });

    it('stores only the id, text and type', () => {
      const payload = { text: 'Oops', type: 'error', consoleError: new Error('failed') } as const;
      const state = reducer(emptyState, addNotification(payload));
      expect(state.notifications[0]).toStrictEqual({
        id: expect.any(String),
        text: 'Oops',
        type: 'error',
      });
    });

    it('supports all notification types', () => {
      const types = ['info', 'success', 'warning', 'error'] as const;
      for (const type of types) {
        const state = reducer(emptyState, addNotification({ text: 'msg', type }));
        expect(state.notifications[0].type).toBe(type);
      }
    });

    it('allows omitting type', () => {
      const state = reducer(emptyState, addNotification({ text: 'no type' }));
      expect(state.notifications[0].type).toBeUndefined();
    });
  });

  describe('removeNotification', () => {
    let stateWithTwo: NotificationState;

    beforeEach(() => {
      stateWithTwo = reducer(emptyState, addNotification({ text: 'First' }));
      stateWithTwo = reducer(stateWithTwo, addNotification({ text: 'Second' }));
    });

    it('removes the notification with the given id', () => {
      const idToRemove = stateWithTwo.notifications[0].id;
      const state = reducer(stateWithTwo, removeNotification(idToRemove));
      expect(state.notifications).toHaveLength(1);
      expect(state.notifications.find((n) => n.id === idToRemove)).toBeUndefined();
    });

    it('keeps other notifications when removing one', () => {
      const [first, second] = stateWithTwo.notifications;
      const state = reducer(stateWithTwo, removeNotification(first.id));
      expect(state.notifications[0].id).toBe(second.id);
    });

    it('does nothing when id does not exist', () => {
      const state = reducer(stateWithTwo, removeNotification('nonexistent-id'));
      expect(state.notifications).toHaveLength(2);
    });
  });

  describe('clearNotifications', () => {
    it('removes all notifications', () => {
      let state = reducer(emptyState, addNotification({ text: 'A' }));
      state = reducer(state, addNotification({ text: 'B' }));
      state = reducer(state, clearNotifications());
      expect(state.notifications).toHaveLength(0);
    });

    it('is a no-op on empty state', () => {
      const state = reducer(emptyState, clearNotifications());
      expect(state.notifications).toHaveLength(0);
    });
  });
});
