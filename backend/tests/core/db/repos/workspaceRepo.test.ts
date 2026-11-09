import { PgDialect } from 'drizzle-orm/pg-core';
import { ApiErrorCodes } from '@soba/lib';

const selectMock = jest.fn();
const transactionMock = jest.fn();

jest.mock('../../../../src/core/db/client', () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
    transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const getWorkspaceForUserMock = jest.fn();

jest.mock('../../../../src/core/db/repos/membershipRepo', () => ({
  ...jest.requireActual('../../../../src/core/db/repos/membershipRepo'),
  getWorkspaceForUser: (...args: unknown[]) => getWorkspaceForUserMock(...args),
}));

import { createTeamWorkspace, updateWorkspace } from '../../../../src/core/db/repos/workspaceRepo';
import { WORKSPACE_NAME_TAKEN } from '../../../../src/core/messages';
import { WorkspaceKind, WorkspaceMembershipRole } from '../../../../src/core/db/codes';
import { WORKSPACE_KIND_ORG_NAME_UNIQUE } from '../../../../src/core/db/schema';

const dialect = new PgDialect();

/**
 * Chains select().from().where().limit() the way the repo queries, resolving to `rows`.
 * Returns the `where` mock so a test can inspect what condition the repo actually filtered on,
 * instead of only knowing that *some* query ran.
 */
function mockSelectResolvesTo(rows: unknown[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
  const whereMock = jest.fn(() => ({ limit: limitMock }));
  const fromMock = jest.fn(() => ({ where: whereMock }));
  selectMock.mockReturnValueOnce({ from: fromMock });
  return whereMock;
}

/** Renders a captured `where(...)` condition to real SQL text and bound params. */
function renderWhere(whereMock: jest.Mock) {
  const [condition] = whereMock.mock.calls[0];
  return dialect.sqlToQuery(condition);
}

/** A unique violation as Drizzle surfaces it: the pg error sits on the wrapper's cause. */
function uniqueViolationOn(constraint: string) {
  return Object.assign(new Error('Failed query'), {
    cause: { code: '23505', severity: 'ERROR', constraint },
  });
}

const membership = {
  id: 'workspace-1',
  kind: WorkspaceKind.team,
  name: 'Existing Name',
  org: 'HLTH',
  useCase: 'internal',
  status: 'active',
  membershipId: 'membership-1',
  role: WorkspaceMembershipRole.owner,
  disclaimerAcceptedAt: null,
};

describe('workspaceRepo', () => {
  beforeEach(() => {
    selectMock.mockReset();
    transactionMock.mockReset();
    getWorkspaceForUserMock.mockReset();
  });

  it('createTeamWorkspace throws a conflict, scoped to this kind/org and case-insensitive, when the name is taken', async () => {
    const whereMock = mockSelectResolvesTo([{ id: 'other-workspace' }]);

    await expect(createTeamWorkspace('user-1', 'Health', 'HLTH', 'internal')).rejects.toMatchObject(
      {
        message: WORKSPACE_NAME_TAKEN,
        code: ApiErrorCodes.workspace_name_taken,
      },
    );
    expect(transactionMock).not.toHaveBeenCalled();

    const { sql: whereSql, params } = renderWhere(whereMock);
    expect(whereSql).toContain('"kind" = $1');
    expect(whereSql).toContain('"org" = $2');
    expect(whereSql).toContain('lower("soba"."workspace"."name") = lower($3)');
    expect(params).toEqual([WorkspaceKind.team, 'HLTH', 'Health']);
  });

  it('createTeamWorkspace succeeds when the name is available', async () => {
    mockSelectResolvesTo([]); // uniqueness check: free

    await createTeamWorkspace('user-1', 'New Name', 'HLTH', 'internal');

    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function));
  });

  // Both saves passed the pre-check; the loser's insert hits the index instead.
  it('createTeamWorkspace reports a name race lost at the unique index as the same conflict', async () => {
    mockSelectResolvesTo([]); // uniqueness check: free, at the time
    transactionMock.mockRejectedValue(uniqueViolationOn(WORKSPACE_KIND_ORG_NAME_UNIQUE));

    await expect(createTeamWorkspace('user-1', 'Health', 'HLTH', 'internal')).rejects.toMatchObject(
      {
        message: WORKSPACE_NAME_TAKEN,
        code: ApiErrorCodes.workspace_name_taken,
      },
    );
  });

  it('createTeamWorkspace passes any other unique violation through unchanged', async () => {
    mockSelectResolvesTo([]);
    const otherViolation = uniqueViolationOn('workspace_group_workspace_name_uq');
    transactionMock.mockRejectedValue(otherViolation);

    await expect(createTeamWorkspace('user-1', 'Health', 'HLTH', 'internal')).rejects.toBe(
      otherViolation,
    );
  });

  it('updateWorkspace reports a name race lost at the unique index as the same conflict', async () => {
    getWorkspaceForUserMock.mockResolvedValue(membership);
    mockSelectResolvesTo([{ displayLabel: 'Actor' }]); // actor display-label lookup
    mockSelectResolvesTo([]); // uniqueness check: free, at the time
    transactionMock.mockRejectedValue(uniqueViolationOn(WORKSPACE_KIND_ORG_NAME_UNIQUE));

    await expect(
      updateWorkspace('workspace-1', 'user-1', { name: 'Health' }),
    ).rejects.toMatchObject({
      message: WORKSPACE_NAME_TAKEN,
      code: ApiErrorCodes.workspace_name_taken,
    });
  });

  it('updateWorkspace throws a conflict when the new name is already taken in the same org', async () => {
    getWorkspaceForUserMock.mockResolvedValue(membership);
    mockSelectResolvesTo([{ displayLabel: 'Actor' }]); // actor display-label lookup
    const whereMock = mockSelectResolvesTo([{ id: 'other-workspace' }]); // uniqueness check: taken

    await expect(
      updateWorkspace('workspace-1', 'user-1', { name: 'Taken Name' }),
    ).rejects.toMatchObject({
      message: WORKSPACE_NAME_TAKEN,
      code: ApiErrorCodes.workspace_name_taken,
    });
    expect(transactionMock).not.toHaveBeenCalled();

    const { sql: whereSql, params } = renderWhere(whereMock);
    expect(whereSql).toContain('"org" = $2');
    expect(whereSql).toContain('lower("soba"."workspace"."name") = lower($3)');
    expect(whereSql).toContain('"id" <> $4');
    expect(params).toEqual([WorkspaceKind.team, 'HLTH', 'Taken Name', 'workspace-1']);
  });

  it('updateWorkspace throws a conflict when moving to an org where the name is already taken there', async () => {
    getWorkspaceForUserMock.mockResolvedValue(membership); // org HLTH, name "Existing Name"
    mockSelectResolvesTo([{ displayLabel: 'Actor' }]); // actor display-label lookup
    const whereMock = mockSelectResolvesTo([{ id: 'other-workspace' }]); // taken in the destination org

    await expect(updateWorkspace('workspace-1', 'user-1', { org: 'EDU' })).rejects.toMatchObject({
      message: WORKSPACE_NAME_TAKEN,
      code: ApiErrorCodes.workspace_name_taken,
    });
    expect(transactionMock).not.toHaveBeenCalled();

    // Checked against the destination org, not the org being left, and the membership's
    // existing name, since this move alone didn't change it.
    const { params } = renderWhere(whereMock);
    expect(params).toEqual([WorkspaceKind.team, 'EDU', 'Existing Name', 'workspace-1']);
  });

  it('updateWorkspace succeeds when the new name is available', async () => {
    getWorkspaceForUserMock.mockResolvedValue(membership);
    mockSelectResolvesTo([{ displayLabel: 'Actor' }]); // actor display-label lookup
    mockSelectResolvesTo([]); // uniqueness check: free

    const setMock = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
    const updateMock = jest.fn(() => ({ set: setMock }));
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({ update: updateMock });
    });

    await expect(updateWorkspace('workspace-1', 'user-1', { name: 'New Name' })).resolves.toBe(
      true,
    );
    expect(updateMock).toHaveBeenCalled();
  });
});
