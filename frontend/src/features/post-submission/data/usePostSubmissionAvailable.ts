import { useId } from 'react';
import useSWR from 'swr';
import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';
import { fetchFeatureAvailability } from '@/src/shared/featureFlags/featureAvailability';

/**
 * Whether post-submission is available for a workspace, or for a form, which a grant to its
 * workspace also covers when the feature is scoped, so a form's scope names both. Asked anew each
 * time the caller mounts, since an administrator can change it at any time. Undefined while the
 * check runs; false without a scope, so a caller without the tab's permission asks nothing, and when
 * the check fails.
 */
export function usePostSubmissionAvailable(
  scope: { workspaceId: string; formId?: string } | null,
): boolean | undefined {
  const readId = useId();
  const { data } = useSWR(
    scope ? ['post-submission-available', scope.workspaceId, scope.formId ?? null, readId] : null,
    () => fetchFeatureAvailability(FEATURE_CODES.POST_SUBMISSION, scope ?? {}),
    sessionReadConfig,
  );
  return scope ? data : false;
}
