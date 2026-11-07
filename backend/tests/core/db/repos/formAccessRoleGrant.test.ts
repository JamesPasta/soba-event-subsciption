jest.mock('../../../../src/core/db/client', () => {
  const { drizzle } = jest.requireActual('drizzle-orm/node-postgres');
  return { db: drizzle.mock() };
});

import { Permissions } from '@soba/lib';
import { effectiveGroups, permissionsByForm } from '../../../../src/core/db/repos/formAccessRepo';

type Query = { sql: string; params: unknown[] };

const PLATFORM_OR_OWN_WORKSPACE =
  '("soba"."role"."workspace_id" is null or "soba"."role"."workspace_id" = "soba"."workspace_group_role"."workspace_id")';

/** The places the query leaves out a deleted role, found by the value each one binds. */
const deletedRoleChecks = ({ sql, params }: Query) =>
  [...sql.matchAll(/"soba"\."role"\."status" <> \$(\d+)/g)].filter(
    (match) => params[Number(match[1]) - 1] === 'inactive',
  ).length;

const occurrences = (sql: string, text: string) => sql.split(text).length - 1;

describe('roles that grant permissions', () => {
  it('leave out a deleted role and one another workspace owns when reading permissions', () => {
    const query = permissionsByForm('user-1', {}).toSQL();
    expect(deletedRoleChecks(query)).toBe(1);
    expect(occurrences(query.sql, PLATFORM_OR_OWN_WORKSPACE)).toBe(1);
  });

  it('leave out the same roles when finding groups by permission, for inherited and overridden groups', () => {
    const query = effectiveGroups('user-1', {
      permissionCode: Permissions.submission_create,
    }).toSQL();
    expect(deletedRoleChecks(query)).toBe(2);
    expect(occurrences(query.sql, PLATFORM_OR_OWN_WORKSPACE)).toBe(2);
  });
});
