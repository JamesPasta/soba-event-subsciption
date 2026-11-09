/** Helper text for a select whose options stopped at the lookup limit. */
export function lookupTruncatedNote(
  template: string,
  lookup: { truncated: boolean; limit?: number },
): string | undefined {
  if (!lookup.truncated || lookup.limit === undefined) return undefined;
  return template.replace('{limit}', String(lookup.limit));
}

/** A select whose selected key is not among its items shows nothing selected. */
export function withSelectedOption<T extends { id: string }>(
  options: T[],
  selected: T | null | undefined,
): T[] {
  if (!selected || options.some((option) => option.id === selected.id)) return options;
  return [...options, selected];
}
