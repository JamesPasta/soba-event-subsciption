import { describe, it, expect } from 'vitest';

import en from '@/dictionaries/en.json';
import fr from '@/dictionaries/fr.json';
import type { Dictionary } from '@/src/types/dictionary';
import { Permissions } from '@/src/types/permissions';
import {
  PERMISSION_AREAS,
  grantsAllPermissions,
  permissionLabel,
  withNeededPermissions,
} from '@/src/features/workspaces/rolePermissions';

const listed = PERMISSION_AREAS.flatMap(({ codes }) => codes);

/** The fixed roles' permissions, as the migrations leave them. */
const FIXED_ROLES = {
  form_designer: ['design_create', 'design_delete', 'design_read', 'design_update', 'form_read'],
  form_submitter: ['document_template_read', 'submission_create'],
  submission_approver: [
    'form_read',
    'submission_print_upload',
    'submission_read',
    'submission_review',
    'team_read',
  ],
  submission_reviewer: [
    'form_read',
    'submission_delete',
    'submission_print_upload',
    'submission_read',
    'submission_review',
    'submission_update',
    'team_read',
  ],
  team_manager: ['form_read', 'team_read', 'team_update'],
};

describe('role permissions', () => {
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

  it.each(Object.entries(FIXED_ROLES))(
    'asks for nothing %s does not already hold',
    (_role, set) => {
      for (const code of set) {
        expect(new Set(withNeededPermissions([], [code]))).toEqual(
          new Set(withNeededPermissions([], [code]).filter((needed) => set.includes(needed))),
        );
      }
    },
  );

  it('adds what a newly ticked permission needs, through every step', () => {
    expect(new Set(withNeededPermissions([], ['submission_update']))).toEqual(
      new Set(['submission_update', 'submission_read', 'form_read']),
    );
    expect(new Set(withNeededPermissions([], ['form_create']))).toEqual(
      new Set(['form_create', 'form_read', 'design_create', 'design_update']),
    );
  });

  it('adds nothing for submitting, which does not go through form_read', () => {
    expect(withNeededPermissions([], ['submission_create'])).toEqual(['submission_create']);
    expect(withNeededPermissions([], ['document_template_read'])).toEqual([
      'document_template_read',
    ]);
  });

  it('touches nothing else when a permission is unticked', () => {
    const before = ['form_read', 'submission_read', 'submission_update'];
    expect(withNeededPermissions(before, ['submission_read', 'submission_update'])).toEqual([
      'submission_read',
      'submission_update',
    ]);
    expect(withNeededPermissions(before, ['form_read', 'submission_update'])).toEqual([
      'form_read',
      'submission_update',
    ]);
  });

  it('does not put back what was unticked earlier when something else is ticked', () => {
    expect(
      withNeededPermissions(['submission_update'], ['submission_update', 'form_delete']),
    ).toEqual(['submission_update', 'form_delete', 'form_read']);
  });
});
