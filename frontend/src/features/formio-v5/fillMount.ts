'use client';

import { useState } from 'react';
import type { SubmitFillBundle } from '@/src/types/forms';

/** What one load mounted the form with: the bundle, and the decisions over it. */
export interface MountedLoad {
  loadId: string;
  bundle: SubmitFillBundle;
  canWrite: boolean;
  canSaveDraft: boolean;
}

/**
 * The load the form shows. A load keeps the bundle it mounted with, so a later read that empties or
 * fails it, such as the re-read when the session ends, leaves the typed answers alone. Its decisions
 * only widen, and only over the same bundle, as when the provider arrives after a failed /me; the
 * next load decides afresh.
 */
export const nextMount = (
  held: MountedLoad | null,
  live: MountedLoad | null,
  loadId: string,
): MountedLoad | null => {
  const current = held?.loadId === loadId ? held : null;
  if (!current || !live) return current ?? live;
  const widens =
    live.bundle === current.bundle &&
    ((live.canWrite && !current.canWrite) || (live.canSaveDraft && !current.canSaveDraft));
  return widens
    ? {
        ...current,
        canWrite: current.canWrite || live.canWrite,
        canSaveDraft: current.canSaveDraft || live.canSaveDraft,
      }
    : current;
};

/** The load to mount for `loadId`, held across renders by nextMount. */
export function useMountedLoad(live: MountedLoad | null, loadId: string): MountedLoad | null {
  const [held, setHeld] = useState<MountedLoad | null>(null);
  const mounted = nextMount(held, live, loadId);
  if (mounted !== held) setHeld(mounted);
  return mounted;
}
