'use client';

import { useEffect } from 'react';
import { InlineAlert } from '@bcgov/design-system-react-components';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import type { NotificationType } from '@/lib/slices/notificationSlice';

const AUTO_DISMISS_MS = 4000;

// Notification types map 1:1 to InlineAlert variants except `error` -> `danger`.
type AlertVariant = 'info' | 'success' | 'warning' | 'danger';
function toVariant(type?: NotificationType): AlertVariant {
  return type === 'error' ? 'danger' : (type ?? 'info');
}

interface NotificationItemProps {
  id: string;
  text: string;
  type?: NotificationType;
  onRemove: (id: string) => void;
}

function NotificationItem({ id, text, type, onRemove }: Readonly<NotificationItemProps>) {
  const isError = type === 'error';

  // An error stays until it is closed, so it can be read at any pace.
  useEffect(() => {
    if (isError) return undefined;
    const timer = setTimeout(() => onRemove(id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [id, isError, onRemove]);

  return (
    <InlineAlert
      variant={toVariant(type)}
      role={isError ? 'alert' : 'status'}
      isCloseable
      onClose={() => onRemove(id)}
    >
      {text}
    </InlineAlert>
  );
}

function NotificationToast() {
  const { notifications, removeNotification } = useNotificationStore();

  if (notifications.length === 0) return null;

  // Fixed, top-centered stack. The DS InlineAlert provides all visual styling;
  // the only custom style here is the positioning of the overlay container,
  // which the design system does not provide.
  return (
    <div
      data-testid="notification-toast"
      className="d-flex flex-column gap-2 d-print-none"
      style={{
        position: 'fixed',
        // Sit just below the DS Header (min-height 65px) rather than overlapping it.
        top: 'calc(65px + 1rem)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1060,
        width: 'min(92vw, 480px)',
      }}
    >
      {notifications.map((n) => (
        <NotificationItem
          key={n.id}
          id={n.id}
          text={n.text}
          type={n.type}
          onRemove={removeNotification}
        />
      ))}
    </div>
  );
}

export { NotificationToast };
