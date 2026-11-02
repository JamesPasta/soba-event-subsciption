// No zod import: the frontend shell takes these through `@soba/lib/sort` without the schemas.

export type SortToken<TField extends string> = `${TField}:asc` | `${TField}:desc`;

export const sortTokensFor = <TField extends string>(
  fields: readonly TField[],
): SortToken<TField>[] =>
  fields.flatMap((field) => [`${field}:asc`, `${field}:desc`] as SortToken<TField>[]);

export const FORM_SORT_FIELDS = ['name', 'status', 'createdAt', 'updatedAt'] as const;

export const MY_FORM_SORT_FIELDS = ['name'] as const;

export const FORM_VERSION_SORT_FIELDS = ['versionNo', 'state', 'createdAt', 'updatedAt'] as const;

export const SUBMISSION_SORT_FIELDS = [
  'formName',
  'submittedAt',
  'createdAt',
  'updatedAt',
] as const;

/** The staff submissions list also sorts by where each review stands and who has it. */
export const STAFF_SUBMISSION_SORT_FIELDS = [
  ...SUBMISSION_SORT_FIELDS,
  'reviewStatus',
  'assignee',
] as const;

export const WORKSPACE_SORT_FIELDS = ['name', 'kind', 'status', 'updatedAt'] as const;

export const SOBA_ADMIN_SORT_FIELDS = ['displayLabel', 'source', 'syncedAt'] as const;

export const WORKSPACE_GROUP_SORT_FIELDS = ['name'] as const;

export const WORKSPACE_ACCESS_SORT_FIELDS = ['displayLabel'] as const;

export const FEATURE_SCOPE_SORT_FIELDS = [
  'featureCode',
  'scopeType',
  'status',
  'createdAt',
  'updatedAt',
] as const;

export const DOCGEN_AUDIT_SORT_FIELDS = ['createdAt', 'outcome', 'durationMs'] as const;

export const JOB_SORT_FIELDS = ['createdAt', 'finishedAt'] as const;

export const SUBMISSION_EXPORT_SORT_FIELDS = ['createdAt'] as const;

export type SortDirection = 'asc' | 'desc';

export const SORT_LOCALES = ['en', 'fr'] as const;
export type SortLocale = (typeof SORT_LOCALES)[number];
export const DEFAULT_SORT_LOCALE: SortLocale = 'en';

/**
 * The sort locale for a language tag or an `Accept-Language` value: `fr` for any French tag,
 * otherwise `en`. Only the first listed language is read.
 */
export function resolveSortLocale(tag: string | null | undefined): SortLocale {
  const primary = (tag ?? '').split(/[,;]/)[0].trim().toLowerCase();
  return primary === 'fr' || primary.startsWith('fr-') ? 'fr' : DEFAULT_SORT_LOCALE;
}

// Each must order as the DB collation `orderByForSort` uses for the same locale: `en` has no
// tailoring, so it matches `und-x-icu`, and `fr-CA` matches `fr-CA-x-icu`. `und` is not a supported
// Intl locale and silently resolves to the runtime default.
export const sortCollators: Record<SortLocale, Intl.Collator> = {
  en: new Intl.Collator('en'),
  fr: new Intl.Collator('fr-CA'),
};

export interface TextSortRules {
  /** Compare with the locale's ICU collation, matching a DB `linguistic` sort. */
  linguistic?: boolean;
  /** Missing values sort last in both directions. */
  nullable?: boolean;
}

const compareCodeUnits = (a: string, b: string): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

/**
 * Order two text values for one sort field the way the backend `orderByForSort` does, so a
 * client-resolved list matches a server-paged one. Strings the collator ranks equal fall back to
 * code unit order.
 */
export function compareTextForSort(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: SortDirection,
  locale: SortLocale,
  rules: TextSortRules = {},
): number {
  const aMissing = a == null;
  const bMissing = b == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const collator = sortCollators[locale] ?? sortCollators[DEFAULT_SORT_LOCALE];
  const cmp = rules.linguistic
    ? collator.compare(a, b) || compareCodeUnits(a, b)
    : compareCodeUnits(a, b);
  return direction === 'desc' ? -cmp : cmp;
}

/**
 * Whether a value contains the search term, matching the backend `ilike(col, '%term%')`: case
 * insensitive, and literal (the DB escapes `%` and `_`, and a substring test never reads them as
 * wildcards). An empty term matches everything; a missing value matches nothing.
 */
export function matchesSearchTerm(value: string | null | undefined, term: string): boolean {
  if (term === '') return true;
  if (value == null) return false;
  return value.toLowerCase().includes(term.toLowerCase());
}
