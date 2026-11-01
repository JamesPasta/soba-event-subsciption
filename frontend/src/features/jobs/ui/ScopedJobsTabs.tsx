'use client';

import { useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { ScopedJobsPanel } from './ScopedJobsPanel';

/** The designer's Jobs tab: the jobs this form's submissions started. */
export function FormJobsTab({ formId }: Readonly<{ formId: string }>) {
  const locale = getLocaleFromPath(usePathname());
  const scope = useMemo(() => ({ kind: 'form', formId }) as const, [formId]);
  const jobHref = useCallback(
    (id: string) => `/${locale}/build/${formId}/jobs/${id}`,
    [locale, formId],
  );
  return <ScopedJobsPanel scope={scope} jobHref={jobHref} />;
}

/** The workspace page's Jobs tab: the jobs its forms' submissions started. */
export function WorkspaceJobsTab({ workspaceId }: Readonly<{ workspaceId: string }>) {
  const locale = getLocaleFromPath(usePathname());
  const scope = useMemo(() => ({ kind: 'workspace', workspaceId }) as const, [workspaceId]);
  const jobHref = useCallback(
    (id: string) => `/${locale}/workspace/${workspaceId}/jobs/${id}`,
    [locale, workspaceId],
  );
  return <ScopedJobsPanel scope={scope} jobHref={jobHref} />;
}
