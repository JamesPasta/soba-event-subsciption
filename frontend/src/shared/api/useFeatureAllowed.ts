'use client';

import useSWR from 'swr';
import { loadFeaturesMeta } from '@/src/shared/config/featuresMeta';
import { createIsFeatureAllowed, type FeatureCode } from '@/src/shared/featureFlags/flags';
import { sessionReadConfig } from './swrConfig';

const isAllowed = ([, code]: readonly [string, FeatureCode]) =>
  loadFeaturesMeta().then(
    (meta) => createIsFeatureAllowed(meta)(code),
    () => false,
  );

/** Whether this app offers the feature: null until the feature list loads, false if it fails. */
export function useFeatureAllowed(code: FeatureCode): boolean | null {
  const { data } = useSWR(['feature-allowed', code] as const, isAllowed, sessionReadConfig);
  return data ?? null;
}
