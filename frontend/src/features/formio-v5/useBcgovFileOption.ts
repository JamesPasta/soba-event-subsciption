'use client';

import { useEffect, useState } from 'react';
import { loadFilesConfig, toBcgovFileOption } from './loadFilesConfig';
import { ensureBcgovFormioRegistered } from './registerBcgovFormio';

/** How long a form waits for the file limits before it mounts without them. */
export const FILE_LIMITS_WAIT_MS = 10_000;

/**
 * The `options.bcgovFile` (blocked extensions + max upload size) the BCGovFile component reads, or {}
 * when the files feature is off, and whether it is settled. Form.io reads options once, when it
 * mounts, so a form waits for `ready`. Gated on the same enablement as the CHEFS provider
 * registration, so no file config is fetched, and no file code runs, when files are disabled.
 * `loadFilesConfig` is cached, so this is deduped across every renderer that uses it.
 */
export function useBcgovFileOption(): { option: Record<string, unknown>; ready: boolean } {
  const [state, setState] = useState<{ option: Record<string, unknown>; ready: boolean }>({
    option: {},
    ready: false,
  });

  useEffect(() => {
    let active = true;
    const settle = async () => {
      const { filesEnabled } = await ensureBcgovFormioRegistered();
      if (!filesEnabled) return {};
      return toBcgovFileOption(await loadFilesConfig());
    };
    // A failed or slow registration settles with no limits, so the form still mounts; the backend
    // still refuses a blocked or oversized file.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<Record<string, unknown>>((resolve) => {
      timer = setTimeout(() => resolve({}), FILE_LIMITS_WAIT_MS);
    });
    void Promise.race([settle().catch(() => ({})), waited]).then((option) => {
      clearTimeout(timer);
      if (active) setState({ option, ready: true });
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  return state;
}
