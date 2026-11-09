import { makeSortEnum } from '../../src/schemas/pagination';
import { sortTokensFor } from '../../src/sort';

describe('sortTokensFor', () => {
  it('declares both directions for every field', () => {
    expect(sortTokensFor(['name', 'status'])).toEqual([
      'name:asc',
      'name:desc',
      'status:asc',
      'status:desc',
    ]);
  });
});

describe('makeSortEnum', () => {
  const schema = makeSortEnum(['name', 'status']);

  it('accepts a declared token', () => {
    expect(schema.parse('status:desc')).toBe('status:desc');
  });

  it('rejects an undeclared field and an undeclared direction', () => {
    expect(schema.safeParse('createdAt:desc').success).toBe(false);
    expect(schema.safeParse('name:sideways').success).toBe(false);
  });
});
