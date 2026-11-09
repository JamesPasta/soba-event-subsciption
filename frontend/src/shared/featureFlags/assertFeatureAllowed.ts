import 'server-only';
import { notFound } from 'next/navigation';
import { loadFeaturesMeta } from '@/src/shared/config/featuresMeta';
import { createIsFeatureAllowed, type FeatureCode } from '@/src/shared/featureFlags/flags';

/** 404s the route when the deployment does not allow the feature. */
export async function assertFeatureAllowed(code: FeatureCode): Promise<void> {
  const featuresMeta = await loadFeaturesMeta();
  if (!createIsFeatureAllowed(featuresMeta)(code)) {
    notFound();
  }
}
