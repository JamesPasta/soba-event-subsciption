import 'server-only';
import { getDictionary, resolveLocale } from '@/app/[lang]/dictionaries';
import type { Dictionary } from '@/src/types/dictionary';

/**
 * Metadata for a localized route. `title` receives the loaded dictionary, since some titles come
 * from it and some are literals.
 */
export async function pageMetadata(
  params: Promise<{ lang: string }>,
  title: (dict: Dictionary) => string,
) {
  const { lang } = await params;
  const dict = await getDictionary(resolveLocale(lang));
  return {
    title: title(dict),
    description: dict.general.description,
  };
}
