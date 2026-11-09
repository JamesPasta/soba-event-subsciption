import type { FilesConfigMetaResponse as FilesConfig } from '@soba/lib';
import { getSobaApiBaseUrl } from '@/src/shared/config/runtimeConfig';

let cached: FilesConfig | null = null;
let inflight: Promise<FilesConfig | null> | null = null;

/**
 * Fetch the backend's files config (size limit + blocked extensions) from the public, feature-gated
 * GET /meta/files-config. Cached; returns null if the feature is off (404) or the request fails (the
 * backend still enforces both). No auth needed — anonymous submitters read the same safeguards.
 */
export function loadFilesConfig(): Promise<FilesConfig | null> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = fetch(`${getSobaApiBaseUrl()}/meta/files-config`)
    .then(async (res) => {
      if (!res.ok) return null;
      cached = (await res.json()) as FilesConfig;
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * Build the `options.bcgovFile` the BCGovFile component reads (blocked extensions + max size).
 * Empty when no config is available.
 */
export function toBcgovFileOption(config: FilesConfig | null): Record<string, unknown> {
  if (!config) return {};
  return {
    bcgovFile: {
      blockedExtensions: config.blockedExtensions,
      fileMaxSize: `${config.maxFileSizeMb}MB`,
    },
  };
}
