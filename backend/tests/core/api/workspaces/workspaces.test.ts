import { ForbiddenError } from '../../../../src/core/errors';

jest.mock('../../../../src/core/db/repos/idpGroupRepo', () => ({
  canCreateWorkspaceByIdp: jest.fn(),
}));

jest.mock('../../../../src/core/db/repos/membershipRepo', () => ({
  ...jest.requireActual('../../../../src/core/db/repos/membershipRepo'),
  getWorkspaceForUser: jest.fn(),
  listWorkspacesForUser: jest.fn(),
}));

jest.mock('../../../../src/core/db/repos/workspaceRepo', () => ({
  createTeamWorkspace: jest.fn(),
  updateWorkspace: jest.fn(),
  workspaceNameExistsForKindAndOrg: jest.fn(),
}));

import { workspacesApiService } from '../../../../src/core/api/workspaces/service';
import * as idpGroupRepo from '../../../../src/core/db/repos/idpGroupRepo';
import * as membershipRepo from '../../../../src/core/db/repos/membershipRepo';
import * as workspaceRepo from '../../../../src/core/db/repos/workspaceRepo';
import { WorkspaceKind } from '../../../../src/core/db/codes';

const actorId = 'user-1';
const workspaceId = '11111111-1111-7111-8111-111111111111';

const workspaceRow = {
  id: workspaceId,
  name: 'Team Alpha',
  kind: 'team',
  role: 'owner',
  status: 'active',
  org: 'IT',
  useCase: 'Internal',
  membershipId: 'membership-1',
  disclaimerAcceptedAt: null,
};

describe('WorkspacesApiService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create provisions a team workspace and returns the workspace item', async () => {
    jest.mocked(idpGroupRepo.canCreateWorkspaceByIdp).mockResolvedValue(true);
    jest.mocked(workspaceRepo.createTeamWorkspace).mockResolvedValue(workspaceId);
    jest.mocked(membershipRepo.getWorkspaceForUser).mockResolvedValue(workspaceRow);

    const result = await workspacesApiService.create(actorId, 'idir', {
      name: 'Team Alpha',
      org: 'IT',
      useCase: 'Internal',
    });

    expect(idpGroupRepo.canCreateWorkspaceByIdp).toHaveBeenCalledWith('idir');

    expect(workspaceRepo.createTeamWorkspace).toHaveBeenCalledWith(
      actorId,
      'Team Alpha',
      'IT',
      'Internal',
      false,
    );
    expect(result).toEqual({
      id: workspaceId,
      name: 'Team Alpha',
      kind: 'team',
      role: 'owner',
      status: 'active',
      org: 'IT',
      useCase: 'Internal',
      disclaimerAccepted: false,
    });
  });

  it('create throws ForbiddenError when IdP is not in the bcgov group', async () => {
    jest.mocked(idpGroupRepo.canCreateWorkspaceByIdp).mockResolvedValue(false);

    await expect(
      workspacesApiService.create(actorId, 'bceidbusiness', {
        name: 'Team Alpha',
        org: 'IT',
        useCase: 'Internal',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(workspaceRepo.createTeamWorkspace).not.toHaveBeenCalled();
  });

  it('updateName returns updated workspace when rename succeeds', async () => {
    jest.mocked(workspaceRepo.updateWorkspace).mockResolvedValue(true);
    jest.mocked(membershipRepo.getWorkspaceForUser).mockResolvedValue({
      ...workspaceRow,
      name: 'Renamed',
    });

    const result = await workspacesApiService.update(workspaceId, actorId, {
      name: 'Renamed',
    });

    expect(workspaceRepo.updateWorkspace).toHaveBeenCalledWith(workspaceId, actorId, {
      name: 'Renamed',
    });
    expect(result?.name).toBe('Renamed');
  });

  it('updateName throws ForbiddenError when actor cannot rename', async () => {
    jest.mocked(workspaceRepo.updateWorkspace).mockResolvedValue(false);

    await expect(
      workspacesApiService.update(workspaceId, actorId, { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('updateName returns null when workspace is missing after update', async () => {
    jest.mocked(workspaceRepo.updateWorkspace).mockResolvedValue(true);
    jest.mocked(membershipRepo.getWorkspaceForUser).mockResolvedValue(null);

    const result = await workspacesApiService.update(workspaceId, actorId, {
      name: 'Renamed',
    });

    expect(result).toBeNull();
  });

  it('checkNameAvailable gates a new name on idp eligibility and reports it free', async () => {
    jest.mocked(idpGroupRepo.canCreateWorkspaceByIdp).mockResolvedValue(true);
    jest.mocked(workspaceRepo.workspaceNameExistsForKindAndOrg).mockResolvedValue(false);

    const result = await workspacesApiService.checkNameAvailable(
      actorId,
      'idir',
      'IT',
      'Team Alpha',
    );

    expect(idpGroupRepo.canCreateWorkspaceByIdp).toHaveBeenCalledWith('idir');
    expect(workspaceRepo.workspaceNameExistsForKindAndOrg).toHaveBeenCalledWith(
      WorkspaceKind.team,
      'IT',
      'Team Alpha',
      undefined,
    );
    expect(result).toEqual({ available: true });
  });

  it('checkNameAvailable reports a new name as taken when the idp can create workspaces', async () => {
    jest.mocked(idpGroupRepo.canCreateWorkspaceByIdp).mockResolvedValue(true);
    jest.mocked(workspaceRepo.workspaceNameExistsForKindAndOrg).mockResolvedValue(true);

    const result = await workspacesApiService.checkNameAvailable(
      actorId,
      'idir',
      'IT',
      'Team Alpha',
    );

    expect(result).toEqual({ available: false });
  });

  it('checkNameAvailable throws ForbiddenError, without checking the name, when the idp cannot create workspaces', async () => {
    jest.mocked(idpGroupRepo.canCreateWorkspaceByIdp).mockResolvedValue(false);

    await expect(
      workspacesApiService.checkNameAvailable(actorId, 'bceidbusiness', 'IT', 'Team Alpha'),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(workspaceRepo.workspaceNameExistsForKindAndOrg).not.toHaveBeenCalled();
  });

  it('checkNameAvailable checks against the excluded workspace when the caller manages it', async () => {
    jest.mocked(membershipRepo.getWorkspaceForUser).mockResolvedValue(workspaceRow); // role: owner
    jest.mocked(workspaceRepo.workspaceNameExistsForKindAndOrg).mockResolvedValue(false);

    const result = await workspacesApiService.checkNameAvailable(
      actorId,
      'idir',
      'IT',
      'Renamed',
      workspaceId,
    );

    expect(membershipRepo.getWorkspaceForUser).toHaveBeenCalledWith(workspaceId, actorId);
    expect(idpGroupRepo.canCreateWorkspaceByIdp).not.toHaveBeenCalled();
    expect(workspaceRepo.workspaceNameExistsForKindAndOrg).toHaveBeenCalledWith(
      WorkspaceKind.team,
      'IT',
      'Renamed',
      workspaceId,
    );
    expect(result).toEqual({ available: true });
  });

  it('checkNameAvailable throws ForbiddenError, without checking the name, when the caller does not manage the excluded workspace', async () => {
    jest.mocked(membershipRepo.getWorkspaceForUser).mockResolvedValue({
      ...workspaceRow,
      role: 'member',
    });

    await expect(
      workspacesApiService.checkNameAvailable(actorId, 'idir', 'IT', 'Renamed', workspaceId),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(workspaceRepo.workspaceNameExistsForKindAndOrg).not.toHaveBeenCalled();
  });

  it('checkNameAvailable throws ForbiddenError when the caller is not a member of the excluded workspace', async () => {
    jest.mocked(membershipRepo.getWorkspaceForUser).mockResolvedValue(null);

    await expect(
      workspacesApiService.checkNameAvailable(actorId, 'idir', 'IT', 'Renamed', workspaceId),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(workspaceRepo.workspaceNameExistsForKindAndOrg).not.toHaveBeenCalled();
  });
});
