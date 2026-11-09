import { compareTextForSort, type SortLocale } from '@soba/lib/sort';

/**
 * Ministries and use cases are stored as codes and rendered from a dictionary keyed by code. The
 * column is free text, so a row can hold something the dictionary does not know: a display name
 * written by an older tool, or a code retired since. Show what is stored rather than hiding it.
 */

type CodeDictionary = Record<string, string>;

type CodeItem = { id: string; label: string };

/** The dictionary label, falling back to the stored value. Null only when nothing is stored. */
export function codeLabel(dictionary: CodeDictionary, value: string | null | undefined) {
  if (!value) return null;
  return dictionary[value] ?? value;
}

/**
 * Dictionary options by label in the sort locale, plus the stored value last when it is not one of
 * them, so a select can show it.
 */
export function codeItems(
  dictionary: CodeDictionary,
  value: string | null | undefined,
  locale: SortLocale,
): CodeItem[] {
  const items = Object.entries(dictionary)
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => compareTextForSort(a.label, b.label, 'asc', locale, { linguistic: true }));
  if (!value || value in dictionary) return items;
  return [...items, { id: value, label: value }];
}
