'use client';

import { useCallback } from 'react';
import { useLocale } from 'react-aria-components';

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
const LONG_DATE_TIME: Intl.DateTimeFormatOptions = { ...LONG_DATE, ...TIME };

function useDateFormatter(options: Intl.DateTimeFormatOptions) {
  const { locale } = useLocale();
  return useCallback(
    (dateStr?: string | null): string => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(locale, options).format(date);
    },
    [locale, options],
  );
}

/**
 * Returns a long-date formatter, e.g. "May 25, 2026" (en) / "25 mai 2026" (fr).
 *
 * Locale comes from the nearest React Aria `<I18nProvider>` (wired in the
 * `[lang]` layout), so dates follow the active app locale instead of a
 * hardcoded one. Empty or invalid input returns ''.
 *
 * The returned function is stable across renders (memoized on locale), so it is
 * safe to use as a `useMemo`/`useCallback` dependency.
 */
export function useFormatLongDate() {
  return useDateFormatter(LONG_DATE);
}

/** As useFormatLongDate, with the time: "May 25, 2026 at 2:05 PM" / "25 mai 2026 à 14 h 05". */
export function useFormatLongDateTime() {
  return useDateFormatter(LONG_DATE_TIME);
}

/** As useFormatLongDate, the time of day only: "2:05 PM" / "14:05". */
export function useFormatTime() {
  return useDateFormatter(TIME);
}
