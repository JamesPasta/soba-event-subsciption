'use client';

import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { forgetListQueries } from '@/src/shared/list/listQueryMemory';

/**
 * Drops everything a departed session leaves behind: the SWR cache and this tab's remembered list
 * queries. Revalidating rather than only emptying, because a key still on screen would otherwise
 * hold `undefined` for the life of the page - a mounted hook only refetches when its key changes.
 */
export function useClearSessionData() {
  const { mutate } = useSWRConfig();
  return useCallback(() => {
    void mutate(() => true, undefined, { revalidate: true });
    forgetListQueries();
  }, [mutate]);
}
