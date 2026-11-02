'use client';

import { useEffect } from 'react';

/** Has the browser confirm a refresh or close while `active`. In-app links are not covered. */
export function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}
