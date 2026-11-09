import { SubmissionService } from '../../../src/core/services/submissionService';
import * as submissionRepo from '../../../src/core/db/repos/submissionRepo';
import * as versionRepo from '../../../src/core/db/repos/formVersionRepo';
import type { SubmissionRecord } from '../../../src/core/db/repos/submissionRepo';

jest.mock('../../../src/core/db/client', () => ({ db: {} }));

jest.mock('../../../src/core/db/repos/submissionRepo', () => ({
  openSubmission: jest.fn(),
  getFormVersionLabels: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formVersionRepo', () => ({
  getPublishedVersionForForm: jest.fn(),
}));

const openSubmission = jest.mocked(submissionRepo.openSubmission);
const getLabels = jest.mocked(submissionRepo.getFormVersionLabels);
const getPublished = jest.mocked(versionRepo.getPublishedVersionForForm);

const svc = new SubmissionService();
const ctx = { workspaceId: 'ws1', actorId: 'u1', actorDisplayLabel: 'Filler' };
const LABELS = { form: { name: 'Permit application' }, formVersion: { versionNo: 2 } };

/** A live submission on form f1, opened on version v1. */
const held = (overrides: Partial<SubmissionRecord> = {}) =>
  ({ id: 's1', formId: 'f1', formVersionId: 'v1', ...overrides }) as SubmissionRecord;

describe('SubmissionService open', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getPublished.mockResolvedValue({ id: 'v1' } as never);
    getLabels.mockResolvedValue(LABELS);
  });

  it("answers a new submission with its form's name and its version's number", async () => {
    openSubmission.mockResolvedValue({ outcome: 'created', record: held() });
    await expect(svc.open({ ...ctx, id: 's1', formId: 'f1' })).resolves.toEqual({
      created: true,
      record: { ...held(), ...LABELS },
    });
    expect(getLabels).toHaveBeenCalledWith('v1');
    expect(openSubmission).toHaveBeenCalledWith(expect.objectContaining({ formVersionId: 'v1' }));
  });

  it.each([
    ['naming the version', 'v1'],
    ['naming no version', undefined],
  ])("answers a retry of the opener's own open, %s, with the submission", async (_label, named) => {
    openSubmission.mockResolvedValue({ outcome: 'taken', live: held(), owner: true });
    await expect(
      svc.open({ ...ctx, id: 's1', formId: 'f1', formVersionId: named }),
    ).resolves.toEqual({ created: false, record: { ...held(), ...LABELS } });
  });

  it("answers a retry naming no version with the opener's submission on an older version", async () => {
    getPublished.mockResolvedValue({ id: 'v2' } as never);
    openSubmission.mockResolvedValue({ outcome: 'taken', live: held(), owner: true });
    await expect(svc.open({ ...ctx, id: 's1', formId: 'f1' })).resolves.toEqual({
      created: false,
      record: { ...held(), ...LABELS },
    });
    // The submission's own version names it, not the one published since.
    expect(getLabels).toHaveBeenCalledWith('v1');
  });

  it.each([
    ['a version since replaced', held({ formVersionId: 'v0' }), true],
    ['another form', held({ formId: 'f2' }), true],
    ["another opener's submission", held(), false],
    ['a deleted submission', null, false],
  ])('refuses an id holding %s with submission_id_taken', async (_label, live, owner) => {
    openSubmission.mockResolvedValue({ outcome: 'taken', live, owner });
    const refused = svc.open({ ...ctx, id: 's1', formId: 'f1', formVersionId: 'v1' });
    await expect(refused).rejects.toMatchObject({ statusCode: 409, code: 'submission_id_taken' });
    expect(getLabels).not.toHaveBeenCalled();
  });
});
