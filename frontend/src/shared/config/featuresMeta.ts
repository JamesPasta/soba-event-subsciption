import { cache } from 'react';
import { getBootstrapApiBaseUrl } from '@/src/shared/config/runtimeConfig';
import type { FeaturesMetaResponse as FeaturesMetaPayload } from '@soba/lib';

export type { FeaturesMetaPayload };
export type { FeatureMeta as MetaFeatureRow } from '@soba/lib';

let cachedFeaturesMeta: FeaturesMetaPayload | null = null;
let featuresMetaPromise: Promise<FeaturesMetaPayload> | null = null;

export function isFeaturesMetaPayload(value: unknown): value is FeaturesMetaPayload {
  if (!value || typeof value !== 'object') return false;
  const parsed = value as { features?: unknown };
  if (!Array.isArray(parsed.features)) return false;
  return parsed.features.every((row) => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Record<string, unknown>;
    return (
      typeof r.code === 'string' &&
      typeof r.name === 'string' &&
      (r.description === null || typeof r.description === 'string') &&
      (r.version === null || typeof r.version === 'string') &&
      typeof r.status === 'string' &&
      typeof r.platformAllowed === 'boolean' &&
      typeof r.availability === 'string'
    );
  });
}

function assertFeaturesMetaShape(value: unknown): asserts value is FeaturesMetaPayload {
  if (!isFeaturesMetaPayload(value)) {
    throw new Error('Features meta payload is invalid');
  }
}

/** Attempts and backoff are deliberately small: this runs during SSR and holds up the render. */
const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 150;

/** A 4xx is an answer, not a blip. Only transport failures and 5xx are worth trying again. */
class RetryableFeaturesMetaError extends Error {}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Node's fetch reports every transport failure as "fetch failed"; the reason is on `cause`. */
function transportReason(error: unknown): string {
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown; message?: unknown }) : null;
  if (typeof cause?.code === 'string' && cause.code) return cause.code;
  if (typeof cause?.message === 'string' && cause.message) return cause.message;
  return error instanceof Error ? error.message : String(error);
}

async function fetchFeaturesMetaOnce(url: string): Promise<FeaturesMetaPayload> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (error) {
    // Transport failure: DNS not resolving yet, a pod rolling, a connection reset.
    throw new RetryableFeaturesMetaError(transportReason(error));
  }
  if (!response.ok) {
    if (response.status >= 500) throw new RetryableFeaturesMetaError(`HTTP ${response.status}`);
    throw new Error(`Failed to load features meta from ${url}: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  assertFeaturesMetaShape(payload);
  return payload;
}

/**
 * Every layout and page gates on this, so a failure takes the whole render down. Backend
 * unreachability is usually momentary, so retry briefly before surfacing it. A persistent outage
 * still throws and is caught by the root error boundary rather than degrading to "no features",
 * which would render as a misconfigured app instead of an unavailable one.
 */
function fetchFeaturesMeta(): Promise<FeaturesMetaPayload> {
  const url = `${getBootstrapApiBaseUrl()}/meta/features`;
  const tryAttempt = async (attempt: number): Promise<FeaturesMetaPayload> => {
    try {
      return await fetchFeaturesMetaOnce(url);
    } catch (error) {
      if (!(error instanceof RetryableFeaturesMetaError)) throw error;
      if (attempt >= FETCH_ATTEMPTS) {
        throw new Error(
          `Features meta unavailable at ${url} after ${attempt} attempts: ${error.message}`,
        );
      }
      await delay(RETRY_DELAY_MS * attempt);
      return tryAttempt(attempt + 1);
    }
  };
  return tryAttempt(1);
}

// Server: memoised per render, so nested layouts and pages share one fetch and the next request
// sees current flags. A module-level cache here would last the pod's lifetime.
const loadFeaturesMetaForRequest = cache(fetchFeaturesMeta);

export async function loadFeaturesMeta(): Promise<FeaturesMetaPayload> {
  if (typeof window === 'undefined') return loadFeaturesMetaForRequest();

  // Browser: the module cache is page-scoped, so a reload picks up changes.
  if (cachedFeaturesMeta) return cachedFeaturesMeta;
  if (featuresMetaPromise) return featuresMetaPromise;

  featuresMetaPromise = fetchFeaturesMeta()
    .then((payload) => {
      cachedFeaturesMeta = payload;
      return payload;
    })
    .finally(() => {
      featuresMetaPromise = null;
    });

  return featuresMetaPromise;
}

export function getCachedFeaturesMeta(): FeaturesMetaPayload | null {
  return cachedFeaturesMeta;
}
