import { TEMPLATE_TYPE_FEATURES } from '@soba/lib';
import { Features } from '../../../src/core/db/codes';

describe('TEMPLATE_TYPE_FEATURES', () => {
  it('names only backend feature codes', () => {
    const codes = new Set<string>(Object.values(Features));
    for (const feature of Object.values(TEMPLATE_TYPE_FEATURES)) {
      expect(codes.has(feature)).toBe(true);
    }
  });
});
