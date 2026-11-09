'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import type { RootState } from '@/lib/store';
import type { DataError, Resource } from './dataContracts';
import { classifyDataError } from './dataError';
import { SessionExpiredError } from './sobaFetch';
import type { DownloadedFile } from './sobaHelpers';

/**
 * Reads a file once the session is ready. It is held in component state, not SWR's cache, so it is
 * freed on unmount. Remount to read another file.
 */
export function useDownload(
  load: (token: string) => Promise<DownloadedFile>,
): Resource<DownloadedFile> {
  const { authenticated, token } = useKeycloak();
  const store = useStore<RootState>();
  const [data, setData] = useState<DownloadedFile | null>(null);
  const [error, setError] = useState<DataError | null>(null);
  const started = useRef(false);

  const read = useCallback(async () => {
    // A retry reads as loading until it settles.
    setError(null);
    try {
      const current = store.getState().keycloak.token;
      if (!current) throw new SessionExpiredError();
      setData(await load(current));
      setError(null);
    } catch (err) {
      setError(classifyDataError(err));
    }
  }, [load, store]);

  // Signed in but still waiting on a token is not ready either, as in useAuthedSWR.
  const ready = authenticated && !!token;

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void read();
  }, [ready, read]);

  return { data, isLoading: !data && !error, error, refresh: read };
}
