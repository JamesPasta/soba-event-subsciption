import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  text: string;
  type?: NotificationType;
}

export type NotificationState = {
  notifications: Notification[];
};

const initialState: NotificationState = {
  notifications: [],
};

let nextId = 0;

const slice = createSlice({
  name: 'notification',
  initialState,
  reducers: {
    addNotification: {
      reducer(state, action: PayloadAction<Notification>) {
        state.notifications.push(action.payload);
      },
      // The id is minted when the action is created, so the reducer stays pure.
      prepare({ text, type }: Omit<Notification, 'id'>) {
        return { payload: { id: String(++nextId), text, type } };
      },
    },
    removeNotification(state, action: PayloadAction<string>) {
      state.notifications = state.notifications.filter((n) => n.id !== action.payload);
    },
    clearNotifications(state) {
      state.notifications = [];
    },
  },
});

export const { addNotification, removeNotification, clearNotifications } = slice.actions;

export default slice.reducer;
