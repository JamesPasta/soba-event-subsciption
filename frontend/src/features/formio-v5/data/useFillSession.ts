'use client';

import { useState } from 'react';
import { useKeycloak } from '@/lib/hooks/useKeycloak';

/** Whether Keycloak has answered, and the session a fill page reads and writes as. */
export interface FillSession {
  ready: boolean;
  signedIn: boolean;
}

/**
 * The session of a fill page, pinned the first time Keycloak answers. Before that, "no token" is the
 * default rather than an answer, so nothing should read yet. Afterwards the page reads and writes as
 * it started: once a signed-in session ends, a call fails as ended rather than going out anonymously.
 */
export function useFillSession(): FillSession {
  const { authenticated, initializing, initStarted } = useKeycloak();
  const answered = initStarted && !initializing;
  const [pinned, setPinned] = useState<boolean | null>(null);
  if (answered && pinned === null) setPinned(authenticated);
  return { ready: answered, signedIn: pinned ?? authenticated };
}
