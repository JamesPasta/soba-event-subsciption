'use client';

import { useCallback } from 'react';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { listReadConfig, sessionReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import { saveBlob } from '@/src/shared/util/saveBlob';
import type { TemplateResponse, TemplateType } from '@/src/types/templates';
import { rereadAfter } from '../templateUpload';
import {
  deleteTemplate,
  downloadTemplate,
  listTemplates,
  replaceTemplateFile,
  uploadTemplate,
} from './api';

const EMPTY_TEMPLATES: TemplateResponse[] = [];

/** A form's document templates and the writes that change them. Each write re-reads the list. */
export function useTemplates(formId: string, currentVersionId: string | null) {
  // A new version is given the templates of the one it came from, so a new current version
  // means a new list. The rows on screen stay until it arrives.
  const { data, error, isLoading, mutate } = useAuthedSWR(
    ['form-templates', formId, currentVersionId],
    (token) => listTemplates(token, formId),
    { ...sessionReadConfig, ...listReadConfig },
  );

  const reread = useCallback(() => mutate(), [mutate]);

  const upload = useCallback(
    (token: string, formVersionId: string, type: TemplateType, name: string, file: File) =>
      rereadAfter(uploadTemplate(token, formVersionId, type, name, file), reread),
    [reread],
  );

  const replace = useCallback(
    (token: string, templateId: string, file: File) =>
      rereadAfter(replaceTemplateFile(token, templateId, file), reread),
    [reread],
  );

  const remove = useCallback(
    (token: string, templateId: string) => rereadAfter(deleteTemplate(token, templateId), reread),
    [reread],
  );

  const download = useCallback(async (token: string, template: TemplateResponse): Promise<void> => {
    saveBlob(await downloadTemplate(token, template.id), template.filename);
  }, []);

  return {
    templates: data?.items ?? EMPTY_TEMPLATES,
    isLoading,
    error: error ? classifyDataError(error) : null,
    upload,
    replace,
    remove,
    download,
  };
}
