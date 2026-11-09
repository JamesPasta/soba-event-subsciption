import { SubmissionService } from '../../../src/core/services/submissionService';
import * as submissionRepo from '../../../src/core/db/repos/submissionRepo';
import * as versionRepo from '../../../src/core/db/repos/formVersionRepo';
import { ConflictError, NotFoundError } from '../../../src/core/errors';

jest.mock('../../../src/core/db/client', () => ({ db: {} }));

jest.mock('../../../src/core/db/repos/submissionRepo', () => ({
  openSubmission: jest.fn(),
  markSubmissionDeleted: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formVersionRepo', () => ({
  getPublishedVersionForForm: jest.fn(),
}));

const markDeleted = jest.mocked(submissionRepo.markSubmissionDeleted);
const openSubmission = jest.mocked(submissionRepo.openSubmission);
const getPublished = jest.mocked(versionRepo.getPublishedVersionForForm);

const svc = new SubmissionService();
const ctx = { workspaceId: 'ws1', actorId: 'u1', actorDisplayLabel: 'Filler' };

// The routes decide these first; the service refuses the same way when the state changes in between.
describe('SubmissionService refusals carry the route codes', () => {
  beforeEach(() => jest.resetAllMocks());

  it('refuses an open once the form has no published version with not_published', async () => {
    getPublished.mockResolvedValue(null);
    const refused = svc.open({ ...ctx, id: 's1', formId: 'f1' });
    await expect(refused).rejects.toBeInstanceOf(NotFoundError);
    await expect(refused).rejects.toMatchObject({ code: 'not_published' });
  });

  it('refuses an open naming a version that is not the published one with version_not_published', async () => {
    getPublished.mockResolvedValue({ id: 'v2' } as never);
    const refused = svc.open({ ...ctx, id: 's1', formId: 'f1', formVersionId: 'v1' });
    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toMatchObject({ code: 'version_not_published' });
  });

  it('refuses an open whose id another submission holds with submission_id_taken', async () => {
    getPublished.mockResolvedValue({ id: 'v1' } as never);
    openSubmission.mockResolvedValue({ outcome: 'taken', live: null, owner: false });
    const refused = svc.open({ ...ctx, id: 's1', formId: 'f1' });
    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toMatchObject({ code: 'submission_id_taken' });
  });

  it('refuses a delete of a submission submitted in the meantime with delete_closed', async () => {
    markDeleted.mockResolvedValue({
      outcome: 'not_deletable',
      workflowState: 'submitted',
    } as never);
    const refused = svc.deleteUnsubmitted({ ...ctx, submissionId: 's1' });
    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toMatchObject({ code: 'delete_closed' });
  });
});
