'use client';

import { useCallback, useEffect, useId } from 'react';
import { unstable_serialize, useSWRConfig } from 'swr';
import { useCallToken } from '@/src/shared/api/callToken';
import { useMaybeAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { Resource } from '@/src/shared/api/dataContracts';
import type { FillSession } from './useFillSession';

/**
 * A read for a fill page, as its session: the identity is in the key, so a signed-in read never
 * serves an anonymous copy. A session read, so it does not revalidate on its own, and one read per
 * mount: each mounted reader keys its own copy, so a page remounted in place never takes the copy
 * of the reader it replaced, which predates any write made since; leaving drops it. Waits until the
 * session is known and `parts` names something to read.
 */
export function useFillRead<T>(
  parts: readonly string[] | null,
  session: FillSession,
  read: (token: string | undefined) => Promise<T>,
): Resource<T> {
  const { tokenFor } = useCallToken();
  const identity = session.signedIn ? 'user' : 'anonymous';
  const reader = useId();
  const key = session.ready && parts ? [...parts, identity, reader] : null;

  const { data, error, isLoading, mutate } = useMaybeAuthedSWR<T>(
    key,
    () => read(tokenFor(session.signedIn)),
    sessionReadConfig,
  );

  // A plain delete, not mutate: a mutate marks the key changed and SWR discards a fetch in flight.
  const { cache } = useSWRConfig();
  const cacheKey = key ? unstable_serialize(key) : null;
  useEffect(() => {
    if (!cacheKey) return undefined;
    return () => cache.delete(cacheKey);
  }, [cacheKey, cache]);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    data: data ?? null,
    isLoading: !key || isLoading,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
}
