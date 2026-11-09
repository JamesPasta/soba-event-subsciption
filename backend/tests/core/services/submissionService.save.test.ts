import { SubmissionService } from '../../../src/core/services/submissionService';
import * as submissionRepo from '../../../src/core/db/repos/submissionRepo';
import * as versionRepo from '../../../src/core/db/repos/formVersionRepo';
import * as formRepo from '../../../src/core/db/repos/formRepo';
import * as registry from '../../../src/core/integrations/form-engine/FormEngineRegistry';
import * as featureAvailability from '../../../src/core/services/featureAvailabilityService';
import * as jobs from '../../../src/core/jobs';
import * as enqueue from '../../../src/core/jobs/enqueue';
import * as resolve from '../../../src/features/post-submission/resolve';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/core/errors';

jest.mock('../../../src/core/db/client', () => ({ db: {} }));

jest.mock('../../../src/core/db/repos/submissionRepo', () => ({
  getSubmissionRecordById: jest.fn(),
  getSubmissionRevisionById: jest.fn(),
  updateSubmissionDraft: jest.fn(),
  appendSubmissionRevision: jest.fn(),
  clearSubmissionProvisioning: jest.fn(),
  failSubmissionProvisioning: jest.fn(),
  openSubmission: jest.fn(),
  getFormVersionLabels: jest.fn(),
  getSubmissionById: jest.fn(),
  listSubmissionsForWorkspace: jest.fn(),
  markSubmissionDeleted: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formVersionRepo', () => ({
  getFormVersionById: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formRepo', () => ({
  getFormEngineCodeForForm: jest.fn(),
}));

jest.mock('../../../src/core/services/featureAvailabilityService', () => ({
  isFeatureAvailable: jest.fn(),
}));

jest.mock('../../../src/core/jobs', () => ({ nudgeJobs: jest.fn() }));

jest.mock('../../../src/core/jobs/enqueue', () => ({
  ...jest.requireActual('../../../src/core/jobs/enqueue'),
  enqueueSubmittedJob: jest.fn(),
}));

jest.mock('../../../src/features/post-submission/resolve', () => ({ availableActions: jest.fn() }));

jest.mock('../../../src/core/integrations/form-engine/FormEngineRegistry', () => ({
  createFormEngineAdapter: jest.fn(),
}));

const getRecord = submissionRepo.getSubmissionRecordById as unknown as jest.Mock;
const getRevisionById = submissionRepo.getSubmissionRevisionById as unknown as jest.Mock;
const updateDraft = submissionRepo.updateSubmissionDraft as unknown as jest.Mock;
const appendRevision = submissionRepo.appendSubmissionRevision as unknown as jest.Mock;
const clearProvisioning = submissionRepo.clearSubmissionProvisioning as unknown as jest.Mock;
const failProvisioning = submissionRepo.failSubmissionProvisioning as unknown as jest.Mock;
const getLabels = submissionRepo.getFormVersionLabels as unknown as jest.Mock;
const getVersion = versionRepo.getFormVersionById as unknown as jest.Mock;
const getEngineCode = formRepo.getFormEngineCodeForForm as unknown as jest.Mock;
const createAdapter = registry.createFormEngineAdapter as unknown as jest.Mock;
const isAvailable = featureAvailability.isFeatureAvailable as unknown as jest.Mock;
const nudge = jobs.nudgeJobs as unknown as jest.Mock;
const enqueueJob = enqueue.enqueueSubmittedJob as unknown as jest.Mock;
const availableActions = resolve.availableActions as unknown as jest.Mock;
const ACTIONS = [
  { plugin: { code: 'post-submission-email-addresses' }, scopes: ['workspace', 'form'] },
];

const input = {
  workspaceId: 'ws1',
  actorId: 'actor-1',
  actorDisplayLabel: 'Filler',
  submissionId: 's1',
  data: { firstName: 'Ada' },
  revisionId: 'rev-new',
  baseRevisionId: 'rev-2',
};

const svc = new SubmissionService();

const LABELS = { form: { name: 'Permit application' }, formVersion: { versionNo: 4 } };

const postSubmissionOn = () => {
  isAvailable.mockResolvedValue(true);
  availableActions.mockResolvedValue(ACTIONS);
  enqueueJob.mockResolvedValue(undefined);
  createAdapter.mockReturnValue({
    createSubmission: jest.fn().mockResolvedValue({ engineRef: 'eng-new' }),
  });
};

describe('SubmissionService save (versioned engine write)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAvailable.mockResolvedValue(false);
    getRecord.mockResolvedValue({
      id: 's1',
      formId: 'f1',
      formVersionId: 'v1',
      currentRevisionNo: 2,
      headRevisionId: 'rev-2',
      engineSubmissionRef: 'eng-prev',
      workflowState: 'draft',
      submittedBy: 'actor-1',
    });
    getRevisionById.mockResolvedValue(null);
    getLabels.mockResolvedValue(LABELS);
    getVersion.mockResolvedValue({ id: 'v1', engineSchemaRef: 'form-ref-1' });
    getEngineCode.mockResolvedValue('formio-v5');
    updateDraft.mockResolvedValue({ id: 's1' });
    appendRevision.mockResolvedValue({
      outcome: 'appended',
      record: { id: 's1', formVersionId: 'v1', currentRevisionNo: 3 },
      revisionId: 'rev-3',
      revisionNo: 3,
      status: 'current',
      reason: 'accepted',
    });
  });

  it("writes the engine document under the client's revision id, then appends it on top of the head it read", async () => {
    const createSubmission = jest.fn().mockResolvedValue({ engineRef: 'eng-new' });
    createAdapter.mockReturnValue({ createSubmission });

    const result = await svc.submit(input);

    expect(createAdapter).toHaveBeenCalledWith('formio-v5');
    expect(createSubmission).toHaveBeenCalledWith({
      engineFormRef: 'form-ref-1',
      submissionId: 's1',
      revisionId: 'rev-new',
      workspaceId: 'ws1',
      data: { firstName: 'Ada' },
      validate: true,
    });
    expect(updateDraft).toHaveBeenCalledWith(
      'ws1',
      's1',
      'Filler',
      expect.objectContaining({ engineSyncStatus: 'provisioning', engineSyncError: null }),
    );
    expect(appendRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 's1',
        revisionId: 'rev-new',
        parentRevisionId: 'rev-2',
        afterEngineSubmissionRef: 'eng-new',
        eventType: 'submitted',
        status: 'current',
        reason: 'accepted',
        workflowState: 'submitted',
      }),
      undefined,
    );
    expect(result).toEqual({
      record: { id: 's1', formVersionId: 'v1', currentRevisionNo: 3, ...LABELS },
      revision: { id: 'rev-3', revisionNo: 3, status: 'current', reason: 'accepted' },
    });
    // The row's state is the write's own; only the labels are read after it.
    expect(getLabels).toHaveBeenCalledWith('v1');
    expect(getRecord).toHaveBeenCalledTimes(1);
  });

  it('writes a draft save without engine validation', async () => {
    const createSubmission = jest.fn().mockResolvedValue({ engineRef: 'eng-new' });
    createAdapter.mockReturnValue({ createSubmission });

    await svc.save(input);

    expect(createSubmission).toHaveBeenCalledWith(expect.objectContaining({ validate: false }));
  });

  it('keeps a write whose head moved after it was read as pending, without an engine error', async () => {
    const createSubmission = jest.fn().mockResolvedValue({ engineRef: 'eng-new' });
    createAdapter.mockReturnValue({ createSubmission });
    appendRevision.mockResolvedValue({
      outcome: 'pending',
      record: { id: 's1', currentRevisionNo: 2 },
      revisionId: 'rev-3',
      revisionNo: 3,
      status: 'pending',
      reason: 'conflict',
    });

    const result = await svc.save(input);

    expect(result.revision).toEqual({
      id: 'rev-3',
      revisionNo: 3,
      status: 'pending',
      reason: 'conflict',
    });
    // This is a current intent (base == loaded head) that the repo downgraded to pending under the
    // lock, so provisioning was advertised; the repo clears it, and the service does not fail it.
    expect(updateDraft).toHaveBeenCalledWith(
      'ws1',
      's1',
      'Filler',
      expect.objectContaining({ engineSyncStatus: 'provisioning' }),
    );
    expect(clearProvisioning).not.toHaveBeenCalled();
    expect(failProvisioning).not.toHaveBeenCalled();
  });

  it.each([
    ['superseded', 'replaced', 'current', 'accepted'],
    ['pending', 'conflict', 'pending', 'conflict'],
  ])(
    'answers a concurrent duplicate that landed %s as any replay does',
    async (status, reason, replayStatus, replayReason) => {
      createAdapter.mockReturnValue({
        createSubmission: jest.fn().mockResolvedValue({ engineRef: 'eng-new' }),
      });
      appendRevision.mockResolvedValue({
        outcome: 'replayed',
        record: { id: 's1', currentRevisionNo: 4 },
        revisionId: 'rev-new',
        revisionNo: 3,
        status,
        reason,
      });

      const result = await svc.save(input);

      expect(result.revision).toEqual({
        id: 'rev-new',
        revisionNo: 3,
        status: replayStatus,
        reason: replayReason,
      });
    },
  );

  const uniqueViolationOn = (constraint: string) =>
    Object.assign(new Error('duplicate key'), {
      cause: { code: '23505', severity: 'ERROR', constraint },
    });

  it('answers revision_id_taken when another write committed the revision id first', async () => {
    createAdapter.mockReturnValue({
      createSubmission: jest.fn().mockResolvedValue({ engineRef: 'eng-new' }),
    });
    appendRevision.mockRejectedValue(uniqueViolationOn('submission_revision_pkey'));

    await expect(svc.save(input)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.save(input)).rejects.toMatchObject({ code: 'revision_id_taken' });
    expect(clearProvisioning).toHaveBeenCalledWith('ws1', 's1');
    expect(failProvisioning).not.toHaveBeenCalled();
  });

  it('passes on a unique violation of any other constraint', async () => {
    createAdapter.mockReturnValue({
      createSubmission: jest.fn().mockResolvedValue({ engineRef: 'eng-new' }),
    });
    const other = uniqueViolationOn('some_other_uq');
    appendRevision.mockRejectedValue(other);

    await expect(svc.save(input)).rejects.toBe(other);
  });

  it('answers not found when the submission is deleted before the revision lands', async () => {
    const createSubmission = jest.fn().mockResolvedValue({ engineRef: 'eng-new' });
    createAdapter.mockReturnValue({ createSubmission });
    appendRevision.mockResolvedValue({ outcome: 'not_found' });

    await expect(svc.save(input)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.save(input)).rejects.toMatchObject({ code: 'submission_not_found' });
    expect(clearProvisioning).toHaveBeenCalledWith('ws1', 's1');
    expect(failProvisioning).not.toHaveBeenCalled();
  });

  it('keeps a submit on a terminal submission as pending (closed), writing the engine document', async () => {
    getRecord.mockResolvedValue({
      id: 's1',
      formId: 'f1',
      formVersionId: 'v1',
      currentRevisionNo: 3,
      headRevisionId: 'rev-3',
      engineSubmissionRef: 'eng-prev',
      workflowState: 'submitted',
      submittedBy: 'actor-1',
    });
    const createSubmission = jest.fn().mockResolvedValue({ engineRef: 'eng-new' });
    createAdapter.mockReturnValue({ createSubmission });
    appendRevision.mockResolvedValue({
      outcome: 'pending',
      record: { id: 's1', currentRevisionNo: 3, workflowState: 'submitted' },
      revisionId: 'rev-4',
      revisionNo: 4,
      status: 'pending',
      reason: 'closed',
    });

    const result = await svc.submit({ ...input, baseRevisionId: 'rev-3' });

    expect(createSubmission).toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
    expect(appendRevision).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', reason: 'closed' }),
      undefined,
    );
    expect(result.revision).toEqual({
      id: 'rev-4',
      revisionNo: 4,
      status: 'pending',
      reason: 'closed',
    });
  });

  it('records error status and rethrows when the engine rejects the submission', async () => {
    const createSubmission = jest.fn().mockRejectedValue(new Error('bad data'));
    createAdapter.mockReturnValue({ createSubmission });

    await expect(svc.submit(input)).rejects.toThrow(/bad data/);

    expect(failProvisioning).toHaveBeenCalledWith('ws1', 's1', 'Filler', 'bad data');
    expect(appendRevision).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the submission is missing', async () => {
    getRecord.mockResolvedValue(null);
    await expect(svc.submit(input)).rejects.toThrow(/not found/i);
    await expect(svc.submit(input)).rejects.toMatchObject({ code: 'submission_not_found' });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('throws when the form version is not provisioned in the engine', async () => {
    getVersion.mockResolvedValue({ id: 'v1', engineSchemaRef: null });
    await expect(svc.submit(input)).rejects.toThrow(/not provisioned/i);
    await expect(svc.submit(input)).rejects.toMatchObject({ code: 'form_not_ready' });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('throws when the form has no engine configured', async () => {
    getEngineCode.mockResolvedValue(null);
    await expect(svc.submit(input)).rejects.toThrow(/form engine/i);
    await expect(svc.submit(input)).rejects.toMatchObject({ code: 'form_not_ready' });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('throws when the engine adapter does not support submissions', async () => {
    createAdapter.mockReturnValue({}); // no createSubmission
    await expect(svc.submit(input)).rejects.toThrow(/does not support/i);
    await expect(svc.submit(input)).rejects.toMatchObject({ code: 'form_not_ready' });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('rejects a base revision from another submission before any engine write', async () => {
    const createSubmission = jest.fn().mockResolvedValue({ engineRef: 'eng-new' });
    createAdapter.mockReturnValue({ createSubmission });
    const foreign = {
      submissionId: 'other-submission',
      eventType: 'saved',
      revisionNo: 5,
      status: 'current',
      reason: 'accepted',
    };
    getRevisionById.mockImplementation(async (id: string) =>
      id === 'rev-foreign' ? foreign : null,
    );

    await expect(svc.save({ ...input, baseRevisionId: 'rev-foreign' })).rejects.toBeInstanceOf(
      ValidationError,
    );

    expect(createSubmission).not.toHaveBeenCalled();
    expect(appendRevision).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('rejects an unknown base revision before any engine write', async () => {
    const createSubmission = jest.fn();
    createAdapter.mockReturnValue({ createSubmission });
    getRevisionById.mockResolvedValue(null);

    await expect(svc.save({ ...input, baseRevisionId: 'rev-ghost' })).rejects.toMatchObject({
      code: 'revision_base_invalid',
    });
    await expect(svc.save({ ...input, baseRevisionId: 'rev-ghost' })).rejects.toBeInstanceOf(
      ValidationError,
    );

    expect(createSubmission).not.toHaveBeenCalled();
    expect(appendRevision).not.toHaveBeenCalled();
  });

  it('replays a since-superseded revision as current (landing disposition, not standing)', async () => {
    getRevisionById.mockResolvedValue({
      submissionId: 's1',
      eventType: 'saved',
      changedBy: 'actor-1',
      revisionNo: 1,
      status: 'superseded',
      reason: 'replaced',
    });
    const createSubmission = jest.fn();
    createAdapter.mockReturnValue({ createSubmission });

    const result = await svc.save({ ...input, revisionId: 'rev-1' });

    expect(result.revision).toEqual({
      id: 'rev-1',
      revisionNo: 1,
      status: 'current',
      reason: 'accepted',
    });
    expect(result.record).toMatchObject({ id: 's1', headRevisionId: 'rev-2', ...LABELS });
    expect(createSubmission).not.toHaveBeenCalled();
    expect(appendRevision).not.toHaveBeenCalled();
  });

  it('replays a pending revision as pending with its reason', async () => {
    getRevisionById.mockResolvedValue({
      submissionId: 's1',
      eventType: 'saved',
      changedBy: 'actor-1',
      revisionNo: 2,
      status: 'pending',
      reason: 'conflict',
    });
    const createSubmission = jest.fn();
    createAdapter.mockReturnValue({ createSubmission });

    const result = await svc.save({ ...input, revisionId: 'rev-held' });

    expect(result.revision).toEqual({
      id: 'rev-held',
      revisionNo: 2,
      status: 'pending',
      reason: 'conflict',
    });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it('refuses a revision id another actor recorded before any engine write', async () => {
    getRevisionById.mockResolvedValue({
      submissionId: 's1',
      eventType: 'saved',
      changedBy: 'actor-2',
      revisionNo: 3,
      status: 'current',
      reason: 'accepted',
    });
    const createSubmission = jest.fn();
    createAdapter.mockReturnValue({ createSubmission });

    await expect(svc.save({ ...input, revisionId: 'rev-3' })).rejects.toBeInstanceOf(ConflictError);

    expect(createSubmission).not.toHaveBeenCalled();
    expect(appendRevision).not.toHaveBeenCalled();
  });

  it('with post-submission on, a submit passes a hook that queues its job, and nudges once appended', async () => {
    postSubmissionOn();

    await svc.submit(input);

    // Available for this form: a grant to the form or to its workspace.
    expect(isAvailable).toHaveBeenCalledWith('post-submission', {
      workspaceId: 'ws1',
      formId: 'f1',
    });
    // The actions' feature checks run before the transaction, for the submission's form.
    expect(availableActions).toHaveBeenCalledWith('ws1', 'f1');
    expect(availableActions.mock.invocationCallOrder[0]).toBeLessThan(
      appendRevision.mock.invocationCallOrder[0],
    );
    const onAppended = appendRevision.mock.calls[0][1];
    await onAppended('tx', { id: 's1' });
    expect(enqueueJob).toHaveBeenCalledWith('tx', { id: 's1' }, 'rev-new', 'actor-1', ACTIONS);
    expect(nudge).toHaveBeenCalledWith('submission.submitted');
  });

  it.each([
    ['pending', 'pending', 'conflict'],
    ['replayed', 'current', 'accepted'],
  ])(
    'with post-submission on, a submit that lands %s does not nudge',
    async (outcome, status, reason) => {
      postSubmissionOn();
      appendRevision.mockResolvedValue({
        outcome,
        record: { id: 's1', formVersionId: 'v1', currentRevisionNo: 2 },
        revisionId: 'rev-new',
        revisionNo: 3,
        status,
        reason,
      });

      await svc.submit(input);

      expect(nudge).not.toHaveBeenCalled();
    },
  );

  it('with post-submission on, a save does not check it, pass a hook or nudge', async () => {
    postSubmissionOn();

    await svc.save(input);

    expect(isAvailable).not.toHaveBeenCalled();
    expect(availableActions).not.toHaveBeenCalled();
    expect(appendRevision).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(nudge).not.toHaveBeenCalled();
  });

  it('with post-submission on, a failure to queue the job fails the provisioning and does not nudge', async () => {
    postSubmissionOn();
    enqueueJob.mockRejectedValue(new Error('job insert failed'));
    appendRevision.mockImplementation(async (_append, onAppended) => {
      await onAppended('tx', { id: 's1' });
    });

    await expect(svc.submit(input)).rejects.toThrow('job insert failed');

    expect(failProvisioning).toHaveBeenCalledWith('ws1', 's1', 'Filler', 'job insert failed');
    expect(nudge).not.toHaveBeenCalled();
  });
});
