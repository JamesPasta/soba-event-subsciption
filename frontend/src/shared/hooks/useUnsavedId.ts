'use client';

import { useMemo, useRef } from 'react';
import { v7 as uuidv7 } from 'uuid';

/** A write's client id, kept until it is saved so a retry of the same write makes it once. */
export function useUnsavedId() {
  const unsaved = useRef<{ key: string; id: string } | null>(null);
  return useMemo(
    () => ({
      /** The id for the write `key` names: the unsaved one when it is the same write. */
      idFor: (key: string) => {
        if (unsaved.current?.key !== key) unsaved.current = { key, id: uuidv7() };
        return unsaved.current.id;
      },
      saved: () => {
        unsaved.current = null;
      },
    }),
    [],
  );
}
