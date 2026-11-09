'use client';

import useSWR from 'swr';
import { fetchFeatureAvailability } from '@/src/shared/featureFlags/featureAvailability';
import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import type { TemplateType } from '@/src/types/templates';
import { availableTemplateTypes } from '../templateUpload';

/** The template types the form can take new files of; null until known. */
export function useTemplateTypes(
  formId: string,
  workspaceId: string | null,
): TemplateType[] | null {
  const { data } = useSWR(
    workspaceId ? ['template-types', workspaceId, formId] : null,
    () =>
      availableTemplateTypes((code) =>
        fetchFeatureAvailability(code, { workspaceId: workspaceId as string, formId }),
      ),
    sessionReadConfig,
  );
  return data ?? null;
}
