import {
  AssignablePermissions,
  CreateWorkspaceRoleBodySchema,
  Permissions,
  UpdateWorkspaceRoleBodySchema,
} from '../src';

describe('workspace role bodies', () => {
  it('accepts every permission but the wildcard', () => {
    const everyOther = Object.values(Permissions).filter((code) => code !== Permissions.all);
    expect(new Set(AssignablePermissions)).toEqual(new Set(everyOther));
    expect(
      CreateWorkspaceRoleBodySchema.safeParse({ name: 'Clerk', permissionCodes: everyOther })
        .success,
    ).toBe(true);
  });

  it('refuses the wildcard and unknown codes', () => {
    for (const code of [Permissions.all, 'not_a_permission']) {
      expect(
        CreateWorkspaceRoleBodySchema.safeParse({ name: 'Clerk', permissionCodes: [code] }).success,
      ).toBe(false);
      expect(UpdateWorkspaceRoleBodySchema.safeParse({ permissionCodes: [code] }).success).toBe(
        false,
      );
    }
  });

  it('needs a name and at least one permission to create', () => {
    const permissionCodes = [Permissions.form_read];
    expect(CreateWorkspaceRoleBodySchema.safeParse({ permissionCodes }).success).toBe(false);
    expect(CreateWorkspaceRoleBodySchema.safeParse({ name: '  ', permissionCodes }).success).toBe(
      false,
    );
    expect(
      CreateWorkspaceRoleBodySchema.safeParse({ name: 'Clerk', permissionCodes: [] }).success,
    ).toBe(false);
  });

  it('trims the name', () => {
    expect(
      CreateWorkspaceRoleBodySchema.parse({
        name: '  Clerk  ',
        permissionCodes: [Permissions.form_read],
      }).name,
    ).toBe('Clerk');
  });

  it('needs something to change on update, and keeps at least one permission', () => {
    expect(UpdateWorkspaceRoleBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateWorkspaceRoleBodySchema.safeParse({ name: 'Clerk' }).success).toBe(true);
    expect(UpdateWorkspaceRoleBodySchema.safeParse({ permissionCodes: [] }).success).toBe(false);
  });
});
