/** Lowercase-hyphenated, filename-safe version of a form name. */
export function kebab(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Builds the designer export filename:
 *   `{name}-v{n}-{state}[-in-design].json`
 * A brand-new, unsaved form (no version/state yet) becomes `{name}-v0-new.json`.
 * The `-in-design` suffix marks a design with unsaved edits.
 */
export function buildExportFilename(
  name: string,
  versionNo: number | null,
  state: string | null,
  isDirty: boolean,
): string {
  const base = kebab(name) || 'form';
  if (versionNo == null || !state) {
    return `${base}-v0-new.json`;
  }
  return `${base}-v${versionNo}-${state}${isDirty ? '-in-design' : ''}.json`;
}
