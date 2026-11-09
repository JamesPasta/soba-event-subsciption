import type { OffsetPage, SortLocale } from '@soba/lib';

export type { OffsetPage } from '@soba/lib';

/** Paging, search and sort, as a list endpoint takes them. */
export type ListQueryArgs = {
  offset: number;
  limit: number;
  sort: string;
  q?: string;
  /** Language to sort text in, for lists with a text sort field. */
  locale?: SortLocale;
};

export const EMPTY_LIST_PAGE: OffsetPage = { offset: 0, limit: 0, total: 0 };

/** Query params for a list request, with the empty search dropped. */
export const toListRequestQuery = (args: ListQueryArgs): Record<string, string | number> => ({
  offset: args.offset,
  limit: args.limit,
  sort: args.sort,
  ...(args.q ? { q: args.q } : {}),
  ...(args.locale ? { locale: args.locale } : {}),
});
