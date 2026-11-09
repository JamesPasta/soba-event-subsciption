jest.mock('../../../src/core/db/repos/formSubmitAccessRepo', () => ({
  hasFormSubmitAccess: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/submitterSubmissionRepo', () => ({
  findSubmitterSubmission: jest.fn(),
}));

import { hasFormSubmitAccess } from '../../../src/core/db/repos/formSubmitAccessRepo';
import { findSubmitterSubmission } from '../../../src/core/db/repos/submitterSubmissionRepo';
import {
  isSubmitterAllowed,
  SubmitterOperation,
  type SubmitterOperationCode,
} from '../../../src/core/services/submitterAccess';
import { Permissions } from '../../../src/core/db/codes';
import { storedSubmission } from '../api/submit/storedSubmission';

const mockFormPermission = jest.mocked(hasFormSubmitAccess);
const mockRead = jest.mocked(findSubmitterSubmission);

const caller = { actorId: 'u1', idpCode: 'idir' };
const target = { workspaceId: 'ws1', formId: 'f1', submissionId: 's1' };
const { read, write, upload, deleteFile, render } = SubmitterOperation;
const NO_PERMISSIONS = { form: { permissions: [] } };
const UPDATE = { form: { permissions: [Permissions.submission_update] } };
const CREATE_ONLY = { form: { permissions: [Permissions.submission_create] } };

beforeEach(() => {
  mockFormPermission.mockReset();
  mockRead.mockReset();
});

describe('isSubmitterAllowed', () => {
  it('opens by the form submit permission, with no submission read', async () => {
    mockFormPermission.mockResolvedValue(true);
    const formTarget = { workspaceId: 'ws1', formId: 'f1' };
    await expect(isSubmitterAllowed(SubmitterOperation.open, formTarget, caller)).resolves.toBe(
      true,
    );
    expect(mockFormPermission).toHaveBeenCalledWith(
      formTarget,
      caller,
      Permissions.submission_create,
    );
    expect(mockRead).not.toHaveBeenCalled();
  });

  // [operation, stored read overrides, allowed]
  const matrix: [SubmitterOperationCode, Parameters<typeof storedSubmission>[0], boolean][] = [
    [read, {}, true],
    [read, { role: null }, false],
    [write, {}, true],
    [write, NO_PERMISSIONS, false],
    [write, { role: null }, false],
    [upload, {}, true],
    [upload, { workflowState: 'opened' }, true],
    [upload, { workflowState: 'submitted' }, false],
    [upload, NO_PERMISSIONS, false],
    [deleteFile, {}, true],
    [deleteFile, { role: null }, false],
    [deleteFile, { role: null, workflowState: 'submitted', ...UPDATE }, true],
    [deleteFile, { workflowState: 'submitted' }, false],
    [render, {}, true],
    [render, NO_PERMISSIONS, false],
    [write, CREATE_ONLY, true],
    [render, CREATE_ONLY, false],
    [render, { role: null }, false],
    [SubmitterOperation.delete, {}, true],
    [SubmitterOperation.delete, { workflowState: 'submitted' }, true],
    [SubmitterOperation.delete, { role: 'collaborator' }, false],
  ];

  it.each(matrix)('%s over the stored read %j is allowed=%s', async (op, overrides, ok) => {
    mockRead.mockResolvedValue(storedSubmission(overrides));
    await expect(isSubmitterAllowed(op, target, caller)).resolves.toBe(ok);
    expect(mockRead).toHaveBeenCalledWith({ submissionId: 's1', actorId: 'u1', idpCode: 'idir' });
  });

  it('refuses the public user a delete of the anonymous submission it owns', async () => {
    mockRead.mockResolvedValue(storedSubmission());
    const publicCaller = { actorId: 'public-user', idpCode: 'public' };
    await expect(isSubmitterAllowed(SubmitterOperation.delete, target, publicCaller)).resolves.toBe(
      false,
    );
  });

  it('refuses an operation on a submission that is not live', async () => {
    mockRead.mockResolvedValue(null);
    await expect(isSubmitterAllowed(read, target, caller)).resolves.toBe(false);
  });

  it('refuses an operation without an actor or a submission, with no read', async () => {
    await expect(isSubmitterAllowed(read, target, { actorId: null })).resolves.toBe(false);
    await expect(
      isSubmitterAllowed(read, { workspaceId: 'ws1', formId: 'f1' }, caller),
    ).resolves.toBe(false);
    expect(mockRead).not.toHaveBeenCalled();
  });
});
