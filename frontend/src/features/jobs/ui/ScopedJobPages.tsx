'use client';

import { useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useDesignFormRead } from '@/src/features/designer/data/useForm';
import { navLink } from '@/src/shared/list/listQueryMemory';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { hasPermission } from '@/src/shared/util/permissions';
import { ScopedJobDetailPanel } from './ScopedJobDetailPanel';

/** A job of a form, opened from the designer's Jobs tab. */
export function FormJobPage({ formId, jobId }: Readonly<{ formId: string; jobId: string }>) {
  const locale = getLocaleFromPath(usePathname());
  // Already read by the designer; says whether the reader may open the job's submission.
  const { data: form } = useDesignFormRead(formId);
  const canReadSubmissions = hasPermission(form?.permissions, 'submission_read') === true;
  const scope = useMemo(() => ({ kind: 'form', formId }) as const, [formId]);
  const jobHref = useCallback(
    (id: string) => `/${locale}/build/${formId}/jobs/${id}`,
    [locale, formId],
  );
  const submissionHref = useCallback(
    (id: string) => `/${locale}/build/${formId}/submissions/${id}`,
    [locale, formId],
  );
  return (
    <ScopedJobDetailPanel
      scope={scope}
      jobId={jobId}
      backHref={navLink(`/${locale}/build/${formId}?tab=jobs`)}
      jobHref={jobHref}
      submissionHref={canReadSubmissions ? submissionHref : undefined}
    />
  );
}

/**
 * A job of a workspace, opened from its Jobs tab. Its submission is not linked: the owner's
 * permissions on the form are not known here.
 */
export function WorkspaceJobPage({
  workspaceId,
  jobId,
}: Readonly<{ workspaceId: string; jobId: string }>) {
  const locale = getLocaleFromPath(usePathname());
  const scope = useMemo(() => ({ kind: 'workspace', workspaceId }) as const, [workspaceId]);
  const jobHref = useCallback(
    (id: string) => `/${locale}/workspace/${workspaceId}/jobs/${id}`,
    [locale, workspaceId],
  );
  return (
    <ScopedJobDetailPanel
      scope={scope}
      jobId={jobId}
      backHref={navLink(`/${locale}/workspace/${workspaceId}?tab=jobs`)}
      jobHref={jobHref}
    />
  );
}
