import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SortLocale } from '@soba/lib';
import { likePattern, orderByForSort } from '../../../src/core/db/listSort';
import { appUsers, submissions, forms } from '../../../src/core/db/schema';

const dialect = new PgDialect();

const toSql = (parts: SQL[]): string =>
  dialect.sqlToQuery(sql.join(parts, sql`, `)).sql.toLowerCase();

const SORT_COLUMNS = {
  formName: { column: forms.name },
  submittedAt: { column: submissions.submittedAt, nullable: true },
  updatedAt: { column: submissions.updatedAt },
};

describe('orderByForSort', () => {
  it('orders ascending or descending on the named column', () => {
    expect(toSql(orderByForSort(SORT_COLUMNS, 'formName:asc', submissions.id, 'en'))).toContain(
      '"name" asc',
    );
    expect(toSql(orderByForSort(SORT_COLUMNS, 'formName:desc', submissions.id, 'en'))).toContain(
      '"name" desc',
    );
  });

  it('appends the tiebreak so ties cannot straddle two pages', () => {
    expect(toSql(orderByForSort(SORT_COLUMNS, 'updatedAt:desc', submissions.id, 'en'))).toContain(
      '"id" desc',
    );
  });

  it('sorts rows with no value last in both directions', () => {
    expect(toSql(orderByForSort(SORT_COLUMNS, 'submittedAt:desc', submissions.id, 'en'))).toContain(
      'desc nulls last',
    );
    expect(toSql(orderByForSort(SORT_COLUMNS, 'submittedAt:asc', submissions.id, 'en'))).toContain(
      'asc nulls last',
    );
  });

  it('orders a linguistic column by the ICU collation', () => {
    const columns = { name: { column: forms.name, linguistic: true } };
    expect(toSql(orderByForSort(columns, 'name:asc', forms.id, 'en'))).toContain(
      '"name" collate "und-x-icu" asc',
    );
  });

  it('orders a linguistic column by the fr-CA collation for fr', () => {
    const columns = { name: { column: forms.name, linguistic: true } };
    expect(toSql(orderByForSort(columns, 'name:asc', forms.id, 'fr'))).toContain(
      '"name" collate "fr-ca-x-icu" asc',
    );
  });

  it('sorts an unknown locale in the en collation', () => {
    const columns = { name: { column: forms.name, linguistic: true } };
    expect(toSql(orderByForSort(columns, 'name:asc', forms.id, 'de' as SortLocale))).toContain(
      '"name" collate "und-x-icu" asc',
    );
  });

  it('keeps missing values last on a nullable linguistic column', () => {
    const columns = {
      displayLabel: { column: appUsers.displayLabel, nullable: true, linguistic: true },
    };
    expect(toSql(orderByForSort(columns, 'displayLabel:desc', appUsers.id, 'en'))).toContain(
      '"display_label" collate "und-x-icu" desc nulls last',
    );
  });

  it('leaves a non-nullable column to the default null ordering', () => {
    expect(
      toSql(orderByForSort(SORT_COLUMNS, 'updatedAt:asc', submissions.id, 'en')),
    ).not.toContain('nulls last');
  });
});

// Only declared tokens reach here through a route, so anything else means validation was bypassed.
describe('orderByForSort rejects what the schema would not have accepted', () => {
  it('refuses a field the list does not declare', () => {
    expect(() =>
      orderByForSort(SORT_COLUMNS, 'secrets:asc' as 'updatedAt:asc', submissions.id, 'en'),
    ).toThrow(/Unsupported sort/);
  });

  it('refuses a direction it cannot render, rather than choosing one', () => {
    expect(() =>
      orderByForSort(
        SORT_COLUMNS,
        'updatedAt:asc; drop table soba.form; --' as 'updatedAt:asc',
        submissions.id,
        'en',
      ),
    ).toThrow(/Unsupported sort/);
  });
});

describe('likePattern', () => {
  it('wraps the term for a contains match', () => {
    expect(likePattern('report')).toBe('%report%');
  });

  it('escapes wildcards so they are matched literally', () => {
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
  });
});
