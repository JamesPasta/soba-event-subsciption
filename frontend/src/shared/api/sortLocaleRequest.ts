import type { SortLocale } from '@soba/lib/sort';

/**
 * Sends the sort locale as `Accept-Language`, which the server reads over the `locale` param. The
 * browser's default follows the browser language, not the app's.
 */
export const sortLocaleHeaders = (locale: SortLocale | undefined): Record<string, string> =>
  locale ? { 'Accept-Language': locale } : {};

/** The `sobaFetch` query and headers for a call whose only query param is the sort locale. */
export const sortLocaleRequest = (locale: SortLocale | undefined) => ({
  query: { locale },
  headers: sortLocaleHeaders(locale),
});
