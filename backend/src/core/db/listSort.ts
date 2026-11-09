import { asc, desc, sql, type Column, type SQL } from 'drizzle-orm';
import { DEFAULT_SORT_LOCALE, type SortLocale, type SortToken } from '@soba/lib';
import { ValidationError } from '../errors';

interface SortableColumn {
  column: Column | SQL;
  /** Rows with no value sort last in both directions. */
  nullable?: boolean;
  /**
   * Order by the sort locale's ICU collation, the same order `compareTextForSort` gives in the
   * browser. An index for such a sort has to be built with the same collation.
   */
  linguistic?: boolean;
}

export type SortColumns<TField extends string> = Record<TField, SortableColumn>;

// ICU collations, so the order is the same on every image and in the browser. Each must order as
// `sortCollators` in lib.
const SORT_COLLATIONS: Record<SortLocale, SQL> = {
  en: sql.raw('"und-x-icu"'),
  fr: sql.raw('"fr-CA-x-icu"'),
};

/** `column` in the sort locale's ICU collation, for an `orderBy` that does not take a sort token. */
export const collated = (column: Column | SQL, locale: SortLocale): SQL =>
  sql`${column} collate ${SORT_COLLATIONS[locale] ?? SORT_COLLATIONS[DEFAULT_SORT_LOCALE]}`;

/**
 * Order for one sort token, with `tiebreak` appended so a query returns rows in the same order on
 * every page request. Without it, ties are ordered by whatever the plan happens to produce and a
 * row can appear on two pages.
 */
export function orderByForSort<TField extends string>(
  columns: SortColumns<TField>,
  token: SortToken<TField>,
  tiebreak: Column,
  locale: SortLocale,
): SQL[] {
  // A repeated query param arrives as an array.
  if (typeof token !== 'string') {
    throw new ValidationError('Unsupported sort');
  }
  const separator = token.lastIndexOf(':');
  const field = token.slice(0, separator) as TField;
  const direction = token.slice(separator + 1);
  const sortable = columns[field];

  // The route schema accepts only declared tokens, so reaching here with another one means the
  // request bypassed validation. Refuse it rather than pick an order for the caller.
  if (!sortable || (direction !== 'asc' && direction !== 'desc')) {
    throw new ValidationError(`Unsupported sort: ${token}`);
  }

  const { column, nullable, linguistic } = sortable;

  if (!nullable && !linguistic) {
    return [direction === 'asc' ? asc(column) : desc(column), desc(tiebreak)];
  }

  const target = linguistic ? collated(column, locale) : sql`${column}`;
  if (direction === 'asc') {
    return [nullable ? sql`${target} asc nulls last` : sql`${target} asc`, desc(tiebreak)];
  }
  return [nullable ? sql`${target} desc nulls last` : sql`${target} desc`, desc(tiebreak)];
}

/**
 * `ilike` pattern for a substring search. Wildcards in the term are escaped, so a name containing
 * `_` or `%` is searched for literally.
 */
export const likePattern = (term: string): string => `%${escapeLike(term)}%`;

/** `like` pattern for a prefix search, with wildcards escaped the same way. */
export const prefixPattern = (term: string): string => `${escapeLike(term)}%`;

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}
