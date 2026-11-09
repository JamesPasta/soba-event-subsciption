import { describe, it, expect } from 'vitest';
import { codeItems, codeLabel } from '@/src/shared/util/codeList';

const MINISTRIES = { HLTH: 'Health (HLTH)', FOR: 'Forests (FOR)' };

describe('codeLabel', () => {
  it('resolves a known code', () => {
    expect(codeLabel(MINISTRIES, 'HLTH')).toBe('Health (HLTH)');
  });

  // A row written before the dictionary existed holds a display name. Showing it beats "Unknown".
  it('returns the stored value when the dictionary does not know it', () => {
    expect(codeLabel(MINISTRIES, 'Ministry of Health')).toBe('Ministry of Health');
  });

  it('reports nothing stored', () => {
    expect(codeLabel(MINISTRIES, null)).toBeNull();
    expect(codeLabel(MINISTRIES, '')).toBeNull();
  });
});

describe('codeItems', () => {
  it('offers the dictionary by label', () => {
    expect(codeItems(MINISTRIES, 'HLTH', 'en')).toEqual([
      { id: 'FOR', label: 'Forests (FOR)' },
      { id: 'HLTH', label: 'Health (HLTH)' },
    ]);
  });

  it('orders accented labels beside their plain letter', () => {
    const labels = { a: 'Zones', b: 'Économie', c: 'Education', d: 'Emploi' };
    expect(codeItems(labels, undefined, 'fr').map((item) => item.label)).toEqual([
      'Économie',
      'Education',
      'Emploi',
      'Zones',
    ]);
  });

  // Without this the select renders its placeholder and the row looks unset.
  it('adds the stored value when it is not in the dictionary', () => {
    expect(codeItems(MINISTRIES, 'Ministry of Health', 'en')).toContainEqual({
      id: 'Ministry of Health',
      label: 'Ministry of Health',
    });
  });

  it('keeps the stored value last, whatever its label', () => {
    expect(codeItems(MINISTRIES, 'Aardvark', 'en').at(-1)).toEqual({
      id: 'Aardvark',
      label: 'Aardvark',
    });
  });

  it('adds nothing for a workspace being created', () => {
    expect(codeItems(MINISTRIES, undefined, 'en')).toHaveLength(2);
  });
});
