import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_KIND_BY_SEGMENT } from '@/src/app/routing/routeSegments';

// Next routes by directory name, so a mapped segment with no matching directory 404s.
const routeDirs = readdirSync(resolve(__dirname, '../../../app/[lang]'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('ROUTE_KIND_BY_SEGMENT', () => {
  it('names only directories that exist under app/[lang]', () => {
    for (const segment of Object.keys(ROUTE_KIND_BY_SEGMENT)) {
      expect(routeDirs, segment).toContain(segment);
    }
  });
});
