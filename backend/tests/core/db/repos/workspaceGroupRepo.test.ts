const selectMock = jest.fn();
const txSelectMock = jest.fn();

jest.mock('../../../../src/core/db/client', () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
    transaction: (run: (tx: unknown) => Promise<unknown>) =>
      run({ select: (...args: unknown[]) => txSelectMock(...args) }),
  },
}));

import {
  getWorkspaceGroup,
  listWorkspaceGroups,
} from '../../../../src/core/db/repos/workspaceGroupRepo';

/** A select chain that resolves to `rows` at whichever builder method the query ends on. */
const chain = (rows: unknown[]) => {
  const end = Promise.resolve(rows) as Promise<unknown[]> & Record<string, jest.Mock>;
  for (const name of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'offset']) {
    end[name] = jest.fn(() => end);
  }
  return end;
};

const MEMBER = { id: 'm1', membershipId: 'wm1', userId: 'u1', displayLabel: 'Ana' };

describe('workspaceGroupRepo', () => {
  beforeEach(() => {
    selectMock.mockReset();
    txSelectMock.mockReset();
  });

  it('reads one page of groups and the total from the same snapshot', async () => {
    const page = chain([]);
    const totals = chain([{ total: 7 }]);
    txSelectMock.mockReturnValueOnce(page).mockReturnValueOnce(totals);

    await expect(
      listWorkspaceGroups({
        workspaceId: 'ws1',
        offset: 5,
        limit: 5,
        sort: 'name:asc',
        locale: 'en',
      }),
    ).resolves.toEqual({ items: [], total: 7 });

    expect(page.limit).toHaveBeenCalledWith(5);
    expect(page.offset).toHaveBeenCalledWith(5);
    // An empty page has no roles or members to load.
    expect(txSelectMock).toHaveBeenCalledTimes(2);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('loads the roles and members of the groups on the page', async () => {
    const group = {
      id: 'g1',
      name: 'Reviewers',
      description: null,
      status: 'active',
      systemCode: null,
    };
    txSelectMock
      .mockReturnValueOnce(chain([group]))
      .mockReturnValueOnce(chain([{ total: 1 }]))
      .mockReturnValueOnce(chain([{ groupId: 'g1', roleCode: 'submission_reviewer' }]))
      .mockReturnValueOnce(chain([{ ...MEMBER, groupId: 'g1' }]));

    const { items } = await listWorkspaceGroups({
      workspaceId: 'ws1',
      offset: 0,
      limit: 20,
      sort: 'name:asc',
      locale: 'en',
    });

    expect(items).toEqual([
      {
        id: 'g1',
        name: 'Reviewers',
        description: null,
        status: 'active',
        system: false,
        roles: ['submission_reviewer'],
        members: [{ ...MEMBER, kind: 'user' }],
      },
    ]);
  });

  it('returns null for a group that is not in the workspace', async () => {
    selectMock.mockReturnValueOnce(chain([]));
    await expect(getWorkspaceGroup('ws1', 'missing', 'en')).resolves.toBeNull();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
