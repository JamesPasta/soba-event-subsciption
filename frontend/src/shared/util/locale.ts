/**
 * Supported locales
 */
const knownLocales = ['en', 'fr'] as const;

/**
 * Small client-side utility to extract locale (en|fr) from a pathname.
 * Designed for use in useClient components.
 */
export function getLocaleFromPath(path?: string | null): string {
  try {
    const firstSegment = path?.split('/').find(Boolean);
    const locale = knownLocales.find((locale) => locale === firstSegment);
    return locale || 'en';
  } catch {
    return 'en';
  }
}
