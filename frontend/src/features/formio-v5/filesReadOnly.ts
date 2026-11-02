import type { FormType } from '@formio/react';

const FILE_COMPONENT_TYPES: ReadonlySet<unknown> = new Set(['file', 'bcgov-file']);

const disableFileComponents = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(disableFileComponents);
  if (!node || typeof node !== 'object') return node;
  const copy: Record<string, unknown> = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, disableFileComponents(value)]),
  );
  return FILE_COMPONENT_TYPES.has(copy.type) ? { ...copy, disabled: true } : copy;
};

/**
 * A copy of a form schema whose file components only show their files, at any depth. Removing a file
 * deletes it at once, before the form is saved, and uploads belong to a submitter's open submission.
 */
export const withFilesReadOnly = (schema: FormType): FormType =>
  disableFileComponents(schema) as FormType;
