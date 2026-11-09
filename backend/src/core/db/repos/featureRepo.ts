import { eq, type InferSelectModel } from 'drizzle-orm';
import { FeatureStatus } from '../codes';
import { db } from '../client';
import { features } from '../schema';

export type FeatureRow = InferSelectModel<typeof features>;

export const listFeatures = async (): Promise<FeatureRow[]> => {
  const rows = await db.select().from(features).orderBy(features.code);
  return rows;
};

export const getFeatureByCode = async (code: string): Promise<FeatureRow | null> => {
  const rows = await db.select().from(features).where(eq(features.code, code)).limit(1);
  return rows[0] ?? null;
};

export const isFeatureEnabled = (status: string): boolean => status === FeatureStatus.enabled;

/** A feature's platform gate: whether it is enabled, and its availability class. Null if not present. */
export interface FeatureGate {
  enabled: boolean;
  availability: string;
}

// Feature status/availability change rarely; cache per code for a short TTL so route gating isn't a
// DB hit per request. feature_scope grants are looked up separately and are NOT cached, so a pilot
// grant change takes effect immediately while a status/availability change settles within the TTL.
const FEATURE_CACHE_TTL_MS = 30_000;
const featureGateCache = new Map<string, { gate: FeatureGate | null; at: number }>();

/** Cached status + availability for a feature, the single source for per-request gating. */
export const getFeatureGateCached = async (
  code: string,
  now: number,
): Promise<FeatureGate | null> => {
  const hit = featureGateCache.get(code);
  if (hit && now - hit.at < FEATURE_CACHE_TTL_MS) return hit.gate;
  const feature = await getFeatureByCode(code);
  const gate: FeatureGate | null = feature
    ? { enabled: isFeatureEnabled(feature.status), availability: feature.availability }
    : null;
  featureGateCache.set(code, { gate, at: now });
  return gate;
};

/** Cached check that a feature is present and enabled, for per-request route gating. */
export const isFeatureEnabledCached = async (code: string, now: number): Promise<boolean> =>
  (await getFeatureGateCached(code, now))?.enabled ?? false;
