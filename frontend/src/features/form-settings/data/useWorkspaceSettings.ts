import { useId } from 'react';
import { useSWRConfig } from 'swr';
import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { classifyDataError } from '@/src/shared/api/dataError';
import { isConflict } from '@/src/shared/api/sobaHelpers';
import type { WorkspaceSettings } from '@/src/types/formSettings';
import { getWorkspaceSettings, setWorkspaceSettings } from './api';

/**
 * A settings group of a workspace, and a save that puts the saved settings in the cache. A save refused
 * because someone else saved first reads the group again before the error reaches the caller. A save
 * that lands, or one refused that way, also drops the group's cached form views, since a form that
 * inherits shows the workspace's values: a mounted view reads again now, an unmounted one when it next
 * mounts.
 */
export function useWorkspaceSettings<TValues>(key: string, workspaceId: string | null) {
  const { mutate: mutateAll } = useSWRConfig();
  const { data, error, mutate } = useAuthedSWR<WorkspaceSettings<TValues>>(
    workspaceId ? ['workspace-settings', key, workspaceId] : null,
    (token) => getWorkspaceSettings<WorkspaceSettings<TValues>>(token, workspaceId as string, key),
    sessionReadConfig,
  );

  // Without data, mutate re-reads mounted keys only; undefined clears the rest as well.
  const dropFormViews = () =>
    mutateAll(
      (cacheKey) =>
        Array.isArray(cacheKey) && cacheKey[0] === 'form-settings' && cacheKey[1] === key,
      undefined,
      { revalidate: true },
    );

  const save = async (token: string, body: WorkspaceSettings<TValues>): Promise<void> => {
    if (!workspaceId) return;
    try {
      await mutate(setWorkspaceSettings(token, workspaceId, key, body), { revalidate: false });
    } catch (err) {
      if (isConflict(err)) await Promise.all([mutate(), dropFormViews()]);
      throw err;
    }
    await dropFormViews();
  };

  return { settings: data, error: error ? classifyDataError(error) : null, save };
}

/**
 * A settings group of a workspace, read anew by each caller that mounts rather than taken from an
 * earlier read, for a choice stored without a version, such as a new form's audience.
 */
export function useFreshWorkspaceSettings<TValues>(key: string, workspaceId: string | null) {
  const readId = useId();
  const { data, error } = useAuthedSWR<WorkspaceSettings<TValues>>(
    workspaceId ? ['workspace-settings', key, workspaceId, readId] : null,
    (token) => getWorkspaceSettings<WorkspaceSettings<TValues>>(token, workspaceId as string, key),
    sessionReadConfig,
  );
  return { settings: data, error: error ? classifyDataError(error) : null };
}
