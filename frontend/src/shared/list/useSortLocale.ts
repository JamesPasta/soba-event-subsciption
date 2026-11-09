'use client';

import { useLocale } from 'react-aria-components';
import { resolveSortLocale, type SortLocale } from '@soba/lib/sort';

/** The sort locale for the active app language, which the `[lang]` layout provides. */
export function useSortLocale(): SortLocale {
  const { locale } = useLocale();
  return resolveSortLocale(locale);
}
