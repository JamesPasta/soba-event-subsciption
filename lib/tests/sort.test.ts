import {
  compareTextForSort,
  matchesSearchTerm,
  resolveSortLocale,
  sortCollators,
  type SortLocale,
  type TextSortRules,
} from '../src/sort';

const order = (list: (string | null | undefined)[], dir: 'asc' | 'desc', rules: TextSortRules) =>
  [...list].sort((a, b) => compareTextForSort(a, b, dir, 'en', rules));

describe('compareTextForSort', () => {
  // Expected order captured from Postgres with `ORDER BY x COLLATE "und-x-icu"`, identical on the
  // musl dev image and the glibc cluster image.
  const dbOrder = [
    'a b',
    'A_b',
    'a-b',
    'a1',
    'a10',
    'a2',
    'ab',
    'Andrew',
    'Ångström',
    'apple',
    'Banana',
    'ça',
    'cafe',
    'café',
    'Café',
    'cafz',
    'cote',
    'coté',
    'côte',
    'côté',
    'cz',
    'ecole',
    'École',
    'elan',
    'Élan',
    'Émile',
    'Eva',
    'Intake 2',
    'Intake_3',
    'Intake-1',
    'intake1',
    'naive',
    'naïve',
    'oeuvre',
    'œuvre',
    'Zebra',
    'zèbre',
    'Zulu',
  ];
  const linguistic = { linguistic: true };

  it('reproduces the database order for accented, mixed-case, punctuated text', () => {
    expect(order([...dbOrder].reverse(), 'asc', linguistic)).toEqual(dbOrder);
  });

  it('reverses that order descending', () => {
    expect(order(dbOrder, 'desc', linguistic)).toEqual([...dbOrder].reverse());
  });

  it('sorts missing values last in both directions', () => {
    const rows = ['b', null, 'a', undefined];
    const asc = order(rows, 'asc', { nullable: true });
    const desc = order(rows, 'desc', { nullable: true });
    expect(asc.slice(0, 2)).toEqual(['a', 'b']);
    expect(asc.slice(2).every((v) => v == null)).toBe(true);
    expect(desc.slice(0, 2)).toEqual(['b', 'a']);
    expect(desc.slice(2).every((v) => v == null)).toBe(true);
  });

  it('resolves each collator to its own locale, not the runtime default', () => {
    expect(sortCollators.en.resolvedOptions().locale).toBe('en');
    expect(sortCollators.fr.resolvedOptions().locale).toBe('fr-CA');
  });

  it('orders accent-only differences from the end of the word in fr', () => {
    // Captured from Postgres with `COLLATE "fr-CA-x-icu"` and `COLLATE "und-x-icu"`.
    const words = ['côté', 'coté', 'côte', 'cote'];
    const sortIn = (locale: SortLocale) =>
      [...words].sort((a, b) => compareTextForSort(a, b, 'asc', locale, linguistic));
    expect(sortIn('fr')).toEqual(['cote', 'côte', 'coté', 'côté']);
    expect(sortIn('en')).toEqual(['cote', 'coté', 'côte', 'côté']);
  });

  it('sorts an unknown locale in the en collator', () => {
    const words = ['côté', 'coté', 'côte', 'cote'];
    const sorted = [...words].sort((a, b) =>
      compareTextForSort(a, b, 'asc', 'de' as SortLocale, linguistic),
    );
    expect(sorted).toEqual(['cote', 'coté', 'côte', 'côté']);
  });

  it('compares by code unit when not linguistic', () => {
    expect(compareTextForSort('Beta', 'alpha', 'asc', 'en')).toBeLessThan(0);
  });
});

describe('resolveSortLocale', () => {
  const cases: [string | null | undefined, SortLocale][] = [
    ['fr', 'fr'],
    ['fr-CA', 'fr'],
    ['FR-ca', 'fr'],
    ['fr-CA,fr;q=0.9,en;q=0.8', 'fr'],
    ['en-CA', 'en'],
    ['en,fr;q=0.9', 'en'],
    ['de-DE', 'en'],
    ['french', 'en'],
    ['*', 'en'],
    ['', 'en'],
    [undefined, 'en'],
    [null, 'en'],
  ];

  it.each(cases)('%p sorts as %p', (tag, expected) => {
    expect(resolveSortLocale(tag)).toBe(expected);
  });
});

describe('matchesSearchTerm', () => {
  // [what it checks, value, term, expected]. Mirrors ilike: case insensitive, literal wildcards,
  // no accent folding, empty term matches all, missing value matches nothing.
  const cases: [string, string | null | undefined, string, boolean][] = [
    ['case-insensitive substring hit', 'Budget Report', 'budget', true],
    ['substring miss', 'Budget Report', 'xyz', false],
    ['percent is literal and present', '50% off', '50%', true],
    ['percent is literal and absent', '50 off', '%', false],
    ['accent kept, exact hit', 'café', 'café', true],
    ['accent not folded to plain', 'café', 'cafe', false],
    ['empty term matches anything', 'anything', '', true],
    ['null value matches nothing', null, 'x', false],
    ['undefined value matches nothing', undefined, 'x', false],
  ];

  it.each(cases)('%s', (_label, value, term, expected) => {
    expect(matchesSearchTerm(value, term)).toBe(expected);
  });
});
