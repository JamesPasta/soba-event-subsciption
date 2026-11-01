const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/** A byte count for people, in the reader's language: 512 bytes, 2.1 kB, 35 MB. */
export const formatFileSize = (bytes: number, locale: string): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
};
