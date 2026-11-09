import { describe, it, expect } from 'vitest';
import { lookupTruncatedNote, withSelectedOption } from '@/src/shared/list/lookupOptions';

describe('lookupTruncatedNote', () => {
  it('says nothing when every match was returned', () => {
    expect(
      lookupTruncatedNote('Showing the first {limit}.', { truncated: false, limit: 500 }),
    ).toBeUndefined();
  });

  it('names the limit when the options were cut off', () => {
    expect(lookupTruncatedNote('Showing the first {limit}.', { truncated: true, limit: 500 })).toBe(
      'Showing the first 500.',
    );
  });
});

describe('withSelectedOption', () => {
  const options = [{ id: 'a' }, { id: 'b' }];

  it('returns the options untouched when the selection is among them or absent', () => {
    expect(withSelectedOption(options, { id: 'b' })).toBe(options);
    expect(withSelectedOption(options, null)).toBe(options);
  });

  it('adds a selection the lookup did not return', () => {
    expect(withSelectedOption(options, { id: 'z' })).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'z' },
    ]);
  });
});
