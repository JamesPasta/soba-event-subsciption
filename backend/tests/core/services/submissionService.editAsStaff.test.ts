import { ApiErrorCodes, SubmissionWorkflowState } from '@soba/lib';
import { SubmissionService } from '../../../src/core/services/submissionService';
import * as submissionRepo from '../../../src/core/db/repos/submissionRepo';
import * as versionRepo from '../../../src/core/db/repos/formVersionRepo';
import * as formRepo from '../../../src/core/db/repos/formRepo';
import * as registry from '../../../src/core/integrations/form-engine/FormEngineRegistry';
import { SubmissionEventType } from '../../../src/core/db/codes';

jest.mock('../../../src/core/db/client', () => ({ db: {} }));

jest.mock('../../../src/core/db/repos/submissionRepo', () => ({
  getSubmissionRecordById: jest.fn(),
  getSubmissionRevisionById: jest.fn(),
  appendStaffEdit: jest.fn(),
  getFormVersionLabels: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formVersionRepo', () => ({
  getFormVersionById: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formRepo', () => ({
  getFormEngineCodeForForm: jest.fn(),
}));

jest.mock('../../../src/core/integrations/form-engine/FormEngineRegistry', () => ({
  createFormEngineAdapter: jest.fn(),
}));

const getRecord = jest.mocked(submissionRepo.getSubmissionRecordById);
const getRevisionById = jest.mocked(submissionRepo.getSubmissionRevisionById);
const appendEdit = jest.mocked(submissionRepo.appendStaffEdit);
const getLabels = jest.mocked(submissionRepo.getFormVersionLabels);
const getVersion = jest.mocked(versionRepo.getFormVersionById);
const getEngineCode = jest.mocked(formRepo.getFormEngineCodeForForm);
const createAdapter = jest.mocked(registry.createFormEngineAdapter);

const input = {
  workspaceId: 'ws1',
  actorId: 'staff-1',
  actorDisplayLabel: 'Staff',
  submissionId: 's1',
  data: { firstName: 'Ada' },
  revisionId: 'rev-new',
  baseRevisionId: 'rev-2',
};
const SUBMITTED = {
  id: 's1',
  formId: 'f1',
  formVersionId: 'v1',
  headRevisionId: 'rev-2',
  engineSubmissionRef: 'eng-prev',
  workflowState: SubmissionWorkflowState.submitted,
};
const LABELS = { form: { name: 'Permit application' }, formVersion: { versionNo: 4 } };

const svc = new SubmissionService();
let createSubmission: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getRecord.mockResolvedValue(SUBMITTED as never);
  getRevisionById.mockResolvedValue(null);
  getLabels.mockResolvedValue(LABELS as never);
  getVersion.mockResolvedValue({ id: 'v1', engineSchemaRef: 'form-ref-1' } as never);
  getEngineCode.mockResolvedValue('formio-v5');
  createSubmission = jest.fn().mockResolvedValue({ engineRef: 'eng-new' });
  createAdapter.mockReturnValue({ createSubmission } as never);
  appendEdit.mockResolvedValue({
    outcome: 'edited',
    record: { ...SUBMITTED, headRevisionId: 'rev-new', engineSubmissionRef: 'eng-new' },
  } as never);
});

it('validates the answers in the engine, then makes them current on top of the loaded head', async () => {
  const record = await svc.editAsStaff(input);

  expect(createSubmission).toHaveBeenCalledWith(
    expect.objectContaining({ revisionId: 'rev-new', data: input.data, validate: true }),
  );
  expect(appendEdit).toHaveBeenCalledWith(
    expect.objectContaining({
      revisionId: 'rev-new',
      baseRevisionId: 'rev-2',
      actorId: 'staff-1',
      afterEngineSubmissionRef: 'eng-new',
    }),
  );
  expect(record).toMatchObject({ headRevisionId: 'rev-new', ...LABELS });
});

it.each([
  ['in progress', { workflowState: SubmissionWorkflowState.draft }, ApiErrorCodes.edit_closed],
  [
    'sent back to revise',
    { workflowState: SubmissionWorkflowState.revising },
    ApiErrorCodes.edit_closed,
  ],
  ['changed since it was loaded', { headRevisionId: 'rev-3' }, ApiErrorCodes.data_changed],
])('refuses a submission %s before any engine write', async (_label, over, code) => {
  getRecord.mockResolvedValue({ ...SUBMITTED, ...over } as never);

  await expect(svc.editAsStaff(input)).rejects.toMatchObject({ statusCode: 409, code });
  expect(createSubmission).not.toHaveBeenCalled();
});

it.each([
  ['closed', ApiErrorCodes.edit_closed],
  ['stale', ApiErrorCodes.data_changed],
  ['taken', ApiErrorCodes.revision_id_taken],
])('answers an edit the lock finds %s with its 409', async (outcome, code) => {
  appendEdit.mockResolvedValue({ outcome } as never);

  await expect(svc.editAsStaff(input)).rejects.toMatchObject({ statusCode: 409, code });
});

it('answers a retry of the same edit as made, without a second engine write', async () => {
  getRevisionById.mockResolvedValue({
    submissionId: 's1',
    eventType: SubmissionEventType.edited,
    changedBy: 'staff-1',
  } as never);

  await expect(svc.editAsStaff(input)).resolves.toMatchObject({ id: 's1' });
  expect(createSubmission).not.toHaveBeenCalled();
  expect(appendEdit).not.toHaveBeenCalled();
});

it('refuses a revision id another write holds', async () => {
  getRevisionById.mockResolvedValue({
    submissionId: 's1',
    eventType: SubmissionEventType.saved,
    changedBy: 'submitter-1',
  } as never);

  await expect(svc.editAsStaff(input)).rejects.toMatchObject({
    code: ApiErrorCodes.revision_id_taken,
  });
});

it('answers 404 for a submission that is gone', async () => {
  getRecord.mockResolvedValue(null);

  await expect(svc.editAsStaff(input)).rejects.toMatchObject({
    statusCode: 404,
    code: ApiErrorCodes.submission_not_found,
  });
});
