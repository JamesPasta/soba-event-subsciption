import { PRINT_REPORT_NAME_MAX_LENGTH } from '@/src/types/templates';

const EXTENSION_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/html': 'html',
};

/** A printed submission's name: its form and confirmation code, or its id until it is submitted. */
export function printBaseName(submission: {
  id: string;
  formName?: string;
  confirmationCode: string | null;
}): string {
  const name = [submission.formName, submission.confirmationCode ?? submission.id]
    .filter(Boolean)
    .join(' ');
  // Characters a file name cannot hold on Windows.
  const cut = name
    .replaceAll(/[\\/:*?"<>|]+/g, '-')
    .trim()
    .slice(0, PRINT_REPORT_NAME_MAX_LENGTH);
  // A cut inside a surrogate pair leaves half a character, which the server refuses.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** The base name with the extension the document's content type implies. */
export function printFileName(baseName: string, rendered: Blob): string {
  const type = rendered.type.split(';')[0]?.trim().toLowerCase() ?? '';
  const extension = EXTENSION_BY_TYPE[type];
  return extension ? `${baseName}.${extension}` : baseName;
}
