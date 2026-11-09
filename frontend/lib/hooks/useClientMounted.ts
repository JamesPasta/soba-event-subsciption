'use client';

import { useSyncExternalStore } from 'react';

function subscribe(): () => void {
  return () => {};
}

/** True on the client after hydration; false during SSR. */
export function useClientMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
