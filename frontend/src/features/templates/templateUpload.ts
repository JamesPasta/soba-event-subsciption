import { classifyDataError, messageForDataError } from '@/src/shared/api/dataError';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import type { FormVersionSummary } from '@/src/types/forms';
import type { TemplateResponse, TemplateType } from '@/src/types/templates';
import { TEMPLATE_TYPE_FEATURES, TEMPLATE_TYPES } from '@/src/types/templates';

/** The template types whose feature is available, in listed order. */
export async function availableTemplateTypes(
  isFeatureAvailable: (featureCode: string) => Promise<boolean>,
): Promise<TemplateType[]> {
  const available = await Promise.all(
    TEMPLATE_TYPES.map((type) => isFeatureAvailable(TEMPLATE_TYPE_FEATURES[type])),
  );
  return TEMPLATE_TYPES.filter((_, index) => available[index]);
}

/** The versions a template can go on: the form's current version first, then the others. */
export function versionOptions(
  current: FormVersionSummary | null,
  others: FormVersionSummary[],
): { id: string; label: string }[] {
  const versions = current ? [current, ...others.filter((v) => v.id !== current.id)] : others;
  return versions.map((v) => ({ id: v.id, label: `v${v.versionNo} (${v.state})` }));
}

/** The template of the type already on the version. An upload there replaces its file. */
export function templateOn(
  templates: TemplateResponse[],
  formVersionId: string | null,
  type: TemplateType,
): TemplateResponse | null {
  return templates.find((t) => t.formVersionId === formVersionId && t.type === type) ?? null;
}

/** Settles as the write does, after re-reading. A failed re-read is left to the reader's own error. */
export async function rereadAfter<T>(
  write: Promise<T>,
  reread: () => Promise<unknown>,
): Promise<T> {
  try {
    return await write;
  } finally {
    await reread().catch(() => undefined);
  }
}

export type UploadErrorText = {
  failed: string;
  typeTaken: string;
  replaceConflict: string;
  tooLarge: string;
  wrongType: string;
  scanFailed: string;
  sessionExpired: string;
  forbidden: string;
};

const UPLOAD_ERRORS: Partial<Record<number, keyof UploadErrorText>> = {
  413: 'tooLarge',
  415: 'wrongType',
  422: 'scanFailed',
};

/**
 * The message for a failed upload or replace: the refusal the user can act on, if there is one. A
 * 409 means the type is taken on an upload, and the template changed underneath on a replace.
 */
export function uploadErrorText(cause: unknown, text: UploadErrorText, replacing: boolean): string {
  if (cause instanceof ApiError) {
    if (cause.status === 409) return replacing ? text.replaceConflict : text.typeTaken;
    const key = UPLOAD_ERRORS[cause.status];
    if (key) return text[key];
  }
  return messageForDataError(classifyDataError(cause), text);
}
