import { describe, it, expect } from 'vitest';

import en from '@/dictionaries/en.json';
import fr from '@/dictionaries/fr.json';
import type { Dictionary } from '@/src/types/dictionary';
import { Permissions } from '@/src/types/permissions';
import {
  PERMISSION_AREAS,
  grantsAllPermissions,
  permissionLabel,
} from '@/src/features/workspaces/rolePermissions';

const listed = PERMISSION_AREAS.flatMap(({ codes }) => codes);

describe('role permission areas', () => {
  it('lists every permission once, leaving out the wildcard', () => {
    const expected = Object.values(Permissions).filter((code) => code !== Permissions.all);
    expect(listed).toHaveLength(expected.length);
    expect(new Set(listed)).toEqual(new Set(expected));
  });

  it.each([
    ['en', en],
    ['fr', fr],
  ])('names every area and permission in %s', (_language, dict) => {
    const t = (dict as Dictionary).workspaces.roles;
    for (const { area, codes } of PERMISSION_AREAS) {
      expect(t.areas[area]).toBeTruthy();
      for (const code of codes) {
        expect(permissionLabel(dict as Dictionary, code)).not.toBe(code);
      }
    }
  });

  it('falls back to the code for a permission with no name', () => {
    expect(permissionLabel(en as Dictionary, 'unknown_permission')).toBe('unknown_permission');
  });

  it('treats only the wildcard as granting everything', () => {
    expect(grantsAllPermissions([Permissions.all])).toBe(true);
    expect(grantsAllPermissions(listed)).toBe(false);
  });
});
