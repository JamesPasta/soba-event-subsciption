jest.mock('../../../../src/core/db/repos/workspaceGroupRepo', () => ({
  groupNameExistsInWorkspace: jest.fn(),
  getWorkspaceGroupMeta: jest.fn(),
  createWorkspaceGroup: jest.fn(),
  renameGroup: jest.fn(),
}));
jest.mock('../../../../src/core/db/repos/roleRepo', () => ({ listRoles: jest.fn() }));

import { groupsApiService } from '../../../../src/core/api/groups/service';
import {
  createWorkspaceGroup,
  getWorkspaceGroupMeta,
  groupNameExistsInWorkspace,
  renameGroup,
} from '../../../../src/core/db/repos/workspaceGroupRepo';

const ctx = { workspaceId: 'ws1', actorDisplayLabel: 'Actor One', locale: 'en' as const };

// The code lets a client say why in its own language; the message alone is English.
const NAME_TAKEN = {
  statusCode: 409,
  code: 'group_name_taken',
  message: 'A group with this name already exists',
};

describe('groupsApiService name conflicts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(groupNameExistsInWorkspace).mockResolvedValue(true);
    jest.mocked(getWorkspaceGroupMeta).mockResolvedValue({ systemCode: null });
  });

  it('refuses to create a group under a name already in use, with a code', async () => {
    await expect(
      groupsApiService.create(ctx, { name: 'Reviewers', roleCodes: [] }),
    ).rejects.toMatchObject(NAME_TAKEN);
    expect(createWorkspaceGroup).not.toHaveBeenCalled();
  });

  it('refuses to rename a group to a name already in use, with a code', async () => {
    await expect(
      groupsApiService.rename(ctx, 'grp-1', { name: 'Reviewers' }),
    ).rejects.toMatchObject(NAME_TAKEN);
    expect(groupNameExistsInWorkspace).toHaveBeenCalledWith('ws1', 'Reviewers', 'grp-1');
    expect(renameGroup).not.toHaveBeenCalled();
  });
});
