import type { FeatureAvailabilityResponse } from '@soba/lib';
import { getSobaApiBaseUrl } from '@/src/shared/config/runtimeConfig';

export interface FeatureScopeQuery {
  workspaceId?: string;
  formId?: string;
}

/**
 * Ask the backend whether a feature is available for a workspace/form scope, via the public
 * GET /meta/feature-availability. This is the only correct way to resolve a `scoped` feature, whose
 * grants live server-side and can't be read from the features meta. Fail-closed: any failure → false,
 * so a feature is hidden rather than shown when availability can't be confirmed.
 */
export async function fetchFeatureAvailability(
  code: string,
  scope: FeatureScopeQuery = {},
): Promise<boolean> {
  const params = new URLSearchParams({ code });
  if (scope.workspaceId) params.set('workspaceId', scope.workspaceId);
  if (scope.formId) params.set('formId', scope.formId);

  try {
    const res = await fetch(
      `${getSobaApiBaseUrl()}/meta/feature-availability?${params.toString()}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as FeatureAvailabilityResponse;
    return body.available === true;
  } catch {
    return false;
  }
}
