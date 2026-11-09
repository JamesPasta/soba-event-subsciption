import express from 'express';
import request from 'supertest';

// Records what each route asks for; the real middleware reads permissions from the database.
const mockPermissionCalls: string[][] = [];

jest.mock('../../../../src/core/middleware/requireFormPermissions', () => ({
  requireFormPermissions: (required: readonly string[]) => {
    mockPermissionCalls.push([...required]);
    return (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
  },
}));

// Stands in for resolving the submission's workspace and form, which reads the database.
jest.mock('../../../../src/core/middleware/workspaceContext', () => ({
  workspaceListScope: () => (_req: unknown, _res: unknown, next: express.NextFunction) => next(),
  workspaceFromResource:
    () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.coreContext = {
        actorId: 'a1',
        workspaceId: 'ws1',
        formId: 'f1',
        actorDisplayLabel: 'Rev Iewer',
      } as unknown as NonNullable<typeof req.coreContext>;
      next();
    },
}));

const mockEditData = jest.fn();
jest.mock('../../../../src/core/api/submissions/service', () => ({
  submissionsApiService: { editData: (...args: unknown[]) => mockEditData(...args) },
}));

const mockRepo = {
  listStatusHistory: jest.fn(),
  listNotes: jest.fn(),
  listEdits: jest.fn(),
  addNote: jest.fn(),
  changeStatus: jest.fn(),
  listReviewUsers: jest.fn(),
};
jest.mock('../../../../src/core/db/repos/submissionReviewRepo', () => ({
  listStatusHistory: (...args: unknown[]) => mockRepo.listStatusHistory(...args),
  listNotes: (...args: unknown[]) => mockRepo.listNotes(...args),
  listEdits: (...args: unknown[]) => mockRepo.listEdits(...args),
  addNote: (...args: unknown[]) => mockRepo.addNote(...args),
  changeStatus: (...args: unknown[]) => mockRepo.changeStatus(...args),
  listReviewUsers: (...args: unknown[]) => mockRepo.listReviewUsers(...args),
}));

const mockAccess = {
  listFormUserIdsHolding: jest.fn(),
  resolveFormPermissions: jest.fn(),
};
jest.mock('../../../../src/core/db/repos/formAccessRepo', () => ({
  listFormUserIdsHolding: (...args: unknown[]) => mockAccess.listFormUserIdsHolding(...args),
  resolveFormPermissions: (...args: unknown[]) => mockAccess.resolveFormPermissions(...args),
}));

const mockGetSubmissionRecordById = jest.fn();
jest.mock('../../../../src/core/db/repos/submissionRepo', () => ({
  getSubmissionRecordById: (...args: unknown[]) => mockGetSubmissionRecordById(...args),
}));

jest.mock('../../../../src/core/services/publicUser', () => ({
  getPublicUser: () => Promise.resolve({ id: 'public-user', displayLabel: 'Public' }),
}));

// What the reactions are does not matter here; the change passes them through to its event.
const REACTIONS = ['reactions-available-here'];
jest.mock('../../../../src/features/submission-review/statusReactions', () => ({
  availableStatusReactions: () => Promise.resolve(REACTIONS),
}));
const mockEnqueueStatusChanged = jest.fn();
jest.mock('../../../../src/core/jobs/enqueue', () => ({
  enqueueStatusChangedJob: (...args: unknown[]) => mockEnqueueStatusChanged(...args),
}));
const mockNudgeJobs = jest.fn();
jest.mock('../../../../src/core/jobs', () => ({
  nudgeJobs: (...args: unknown[]) => mockNudgeJobs(...args),
}));

const mockFindEffectiveReviewSettings = jest.fn();
jest.mock('../../../../src/features/form-settings/review/repo', () => ({
  findEffectiveReviewSettings: (...args: unknown[]) => mockFindEffectiveReviewSettings(...args),
}));

import { ApiErrorCodes, SubmissionReviewStatuses } from '@soba/lib';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';
import { Permissions } from '../../../../src/core/db/codes';
import { designSubmissionsRouter } from '../../../../src/core/api/submissions/route';

const app = express();
app.use(express.json());
app.use('/submissions', designSubmissionsRouter);
app.use(coreErrorHandler);

const NOTE_ID = '01a1891a-3246-773c-a7ec-39fca5fea6bf';
const STATUS_ID = '01a1891a-3246-773c-a7ec-39fca5fea6c0';
const FROM_STATUS_ID = '01a1891a-3246-773c-a7ec-39fca5fea6c1';
const REVIEWER_ID = '01a1891a-3246-773c-a7ec-39fca5fea6c2';
const NOTES_PATH = '/submissions/sub1/review/notes';
const STATUS_PATH = '/submissions/sub1/review/status';
const REVIEWERS_PATH = '/submissions/sub1/review/reviewers';

const SUBMITTED = {
  id: 'st1',
  status: SubmissionReviewStatuses.submitted,
  assignee: null,
  changedAt: '2026-10-01T10:00:00.000Z',
  updatedBy: 'Sub Mitter',
};
const NOTE = {
  id: NOTE_ID,
  text: 'Needs a second look',
  createdAt: '2026-10-02T10:00:00.000Z',
  createdBy: 'Rev Iewer',
};
const REVIEWER = { id: REVIEWER_ID, displayName: 'Grace Hopper', email: 'grace@example.com' };
const ASSIGN = {
  id: STATUS_ID,
  fromStatusId: FROM_STATUS_ID,
  status: SubmissionReviewStatuses.assigned,
  assigneeId: REVIEWER_ID,
};
const REVISE = { ...ASSIGN, status: SubmissionReviewStatuses.revising, assigneeId: null };
const SETTINGS_ON = { allowStatusUpdates: true, allowSubmitterRevision: false };
const SETTINGS_OFF = { allowStatusUpdates: false, allowSubmitterRevision: false };

describe('submission review routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.listStatusHistory.mockResolvedValue([SUBMITTED]);
    mockRepo.listNotes.mockResolvedValue([]);
    mockRepo.listEdits.mockResolvedValue([]);
    mockRepo.addNote.mockResolvedValue('added');
    mockRepo.changeStatus.mockResolvedValue('changed');
    mockRepo.listReviewUsers.mockResolvedValue([REVIEWER]);
    mockAccess.listFormUserIdsHolding.mockResolvedValue([REVIEWER_ID]);
    mockAccess.resolveFormPermissions.mockResolvedValue(new Set([Permissions.submission_review]));
    mockFindEffectiveReviewSettings.mockResolvedValue(SETTINGS_ON);
    mockGetSubmissionRecordById.mockResolvedValue({ id: 'sub1', submittedBy: 'submitter-1' });
    mockEnqueueStatusChanged.mockResolvedValue(undefined);
  });

  it('gates the read on submission_read, and the writes and reviewers on submission_review', () => {
    expect(mockPermissionCalls.slice(-4)).toEqual([
      [Permissions.submission_read],
      [Permissions.submission_review],
      [Permissions.submission_review],
      [Permissions.submission_review],
    ]);
  });

  it("reads the submission's settings, status history, notes and edits in its workspace", async () => {
    mockRepo.listNotes.mockResolvedValue([NOTE]);
    const response = await request(app).get('/submissions/sub1/review');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      allowStatusUpdates: true,
      statusHistory: [SUBMITTED],
      notes: [NOTE],
      editHistory: [],
    });
    expect(mockFindEffectiveReviewSettings).toHaveBeenCalledWith('ws1', 'f1');
    for (const read of [mockRepo.listStatusHistory, mockRepo.listNotes, mockRepo.listEdits]) {
      expect(read).toHaveBeenCalledWith('ws1', 'sub1');
    }
  });

  it('adds a trimmed note under the caller and answers with the updated review', async () => {
    mockRepo.listNotes.mockResolvedValue([NOTE]);
    const response = await request(app)
      .post(NOTES_PATH)
      .send({ id: NOTE_ID, text: '  Needs a second look  ' });

    expect(response.status).toBe(200);
    expect(mockRepo.addNote).toHaveBeenCalledWith({
      id: NOTE_ID,
      workspaceId: 'ws1',
      submissionId: 'sub1',
      text: 'Needs a second look',
      actorId: 'a1',
      actorDisplayLabel: 'Rev Iewer',
    });
    expect(response.body.notes).toEqual([NOTE]);
  });

  // A retry after a lost response must not fail: the note is already there.
  it('answers a retried note as saved', async () => {
    mockRepo.addNote.mockResolvedValue('replayed');
    const response = await request(app)
      .post(NOTES_PATH)
      .send({ id: NOTE_ID, text: 'Needs a second look' });

    expect(response.status).toBe(200);
  });

  it('refuses an id already used for a different note', async () => {
    mockRepo.addNote.mockResolvedValue('taken');
    const response = await request(app)
      .post(NOTES_PATH)
      .send({ id: NOTE_ID, text: 'Something else' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(ApiErrorCodes.note_id_taken);
  });

  it('answers 404 for a submission that is gone', async () => {
    mockRepo.addNote.mockResolvedValue('missing');
    const response = await request(app)
      .post(NOTES_PATH)
      .send({ id: NOTE_ID, text: 'Needs a second look' });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ApiErrorCodes.submission_not_found);
  });

  it.each([
    ['a blank note', { id: NOTE_ID, text: '   ' }],
    ['a note over 4000 characters', { id: NOTE_ID, text: 'x'.repeat(4001) }],
    ['a note without an id', { text: 'Needs a second look' }],
    ['an id that is not a UUID', { id: 'note-1', text: 'Needs a second look' }],
  ])('refuses %s', async (_label, body) => {
    const response = await request(app).post(NOTES_PATH).send(body);

    expect(response.status).toBe(400);
    expect(mockRepo.addNote).not.toHaveBeenCalled();
  });

  it('accepts a note of exactly 4000 characters', async () => {
    const response = await request(app)
      .post(NOTES_PATH)
      .send({ id: NOTE_ID, text: 'x'.repeat(4000) });

    expect(response.status).toBe(200);
  });

  it('assigns the submission under the caller and answers with the updated review', async () => {
    const response = await request(app).post(STATUS_PATH).send(ASSIGN);

    expect(response.status).toBe(200);
    expect(mockAccess.resolveFormPermissions).toHaveBeenCalledWith(REVIEWER_ID, 'ws1', 'f1');
    expect(mockRepo.changeStatus).toHaveBeenCalledWith({
      ...ASSIGN,
      workspaceId: 'ws1',
      submissionId: 'sub1',
      actorId: 'a1',
      actorDisplayLabel: 'Rev Iewer',
      allowStatusUpdates: true,
      onChanged: expect.any(Function),
    });
    expect(response.body.statusHistory).toEqual([SUBMITTED]);
  });

  it('completes the submission without checking an assignee', async () => {
    const response = await request(app)
      .post(STATUS_PATH)
      .send({ ...ASSIGN, status: SubmissionReviewStatuses.completed, assigneeId: null });

    expect(response.status).toBe(200);
    expect(mockAccess.resolveFormPermissions).not.toHaveBeenCalled();
  });

  // Under the lock, so a revision can still be ended when its form's settings turn updates off.
  it("passes the form's setting to the change, and answers its refusal as 403", async () => {
    mockFindEffectiveReviewSettings.mockResolvedValue(SETTINGS_OFF);
    mockRepo.changeStatus.mockResolvedValue('updates_off');
    const response = await request(app).post(STATUS_PATH).send(ASSIGN);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe(ApiErrorCodes.status_updates_disabled);
    expect(mockRepo.changeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ allowStatusUpdates: false }),
    );
  });

  it('refuses an assignee who cannot review the form', async () => {
    mockAccess.resolveFormPermissions.mockResolvedValue(new Set([Permissions.submission_read]));
    const response = await request(app).post(STATUS_PATH).send(ASSIGN);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ApiErrorCodes.assignee_invalid);
    expect(mockRepo.changeStatus).not.toHaveBeenCalled();
  });

  it('refuses an assignee who is not an active user, as the picker leaves them out', async () => {
    mockRepo.listReviewUsers.mockResolvedValue([]);
    const response = await request(app).post(STATUS_PATH).send(ASSIGN);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ApiErrorCodes.assignee_invalid);
    expect(mockRepo.changeStatus).not.toHaveBeenCalled();
  });

  // A retry after a lost response must not fail: the change is already made.
  it('answers a retried change as saved', async () => {
    mockRepo.changeStatus.mockResolvedValue('replayed');
    const response = await request(app).post(STATUS_PATH).send(ASSIGN);

    expect(response.status).toBe(200);
  });

  it.each([
    ['taken', 409, ApiErrorCodes.status_id_taken],
    ['stale', 409, ApiErrorCodes.status_changed],
    ['not_allowed', 409, ApiErrorCodes.status_move_not_allowed],
    ['missing', 404, ApiErrorCodes.submission_not_found],
  ])('answers a %s change with %i %s', async (outcome, status, code) => {
    mockRepo.changeStatus.mockResolvedValue(outcome);
    const response = await request(app).post(STATUS_PATH).send(ASSIGN);

    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
  });

  it.each([
    ['Assigned and no assignee', { ...ASSIGN, assigneeId: null }],
    ['Completed and an assignee', { ...ASSIGN, status: SubmissionReviewStatuses.completed }],
    ['no current status', { ...ASSIGN, fromStatusId: undefined }],
    ['an unknown status', { ...ASSIGN, status: 'CLOSED' }],
  ])('refuses a status change with %s', async (_label, body) => {
    const response = await request(app).post(STATUS_PATH).send(body);

    expect(response.status).toBe(400);
    expect(mockRepo.changeStatus).not.toHaveBeenCalled();
  });

  it("records the change as an event in its transaction, with the reviewer's comment choice", async () => {
    // The repo runs the callback inside the transaction once it makes the change.
    mockRepo.changeStatus.mockImplementation(
      async (input: { onChanged?: (tx: unknown) => Promise<void> }) => {
        await input.onChanged?.('tx');
        return 'changed';
      },
    );
    const comment = 'Please attach the declaration.';
    await request(app)
      .post(STATUS_PATH)
      .send({ ...REVISE, comment, attachCommentToEmail: true });
    await request(app)
      .post(STATUS_PATH)
      .send({ ...REVISE, id: NOTE_ID, comment });

    expect(mockRepo.changeStatus).toHaveBeenCalledWith(expect.objectContaining({ comment }));
    const change = {
      workspaceId: 'ws1',
      formId: 'f1',
      submissionId: 'sub1',
      status: SubmissionReviewStatuses.revising,
      assigneeId: null,
      actorId: 'a1',
    };
    expect(mockEnqueueStatusChanged.mock.calls).toEqual([
      ['tx', { ...change, id: STATUS_ID, attachComment: true }, REACTIONS],
      ['tx', { ...change, id: NOTE_ID, attachComment: false }, REACTIONS],
    ]);
    expect(mockNudgeJobs).toHaveBeenCalledWith('submission.status-changed');
  });

  // A retry after a lost response must not email anyone a second time.
  it('records and nudges nothing for a retried change', async () => {
    mockRepo.changeStatus.mockResolvedValue('replayed');
    await request(app).post(STATUS_PATH).send(ASSIGN);

    expect(mockEnqueueStatusChanged).not.toHaveBeenCalled();
    expect(mockNudgeJobs).not.toHaveBeenCalled();
  });

  it('sends a signed-in submission back to its submitter to revise', async () => {
    const response = await request(app).post(STATUS_PATH).send(REVISE);

    expect(response.status).toBe(200);
    expect(mockGetSubmissionRecordById).toHaveBeenCalledWith('ws1', 'sub1');
    expect(mockRepo.changeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: SubmissionReviewStatuses.revising, assigneeId: null }),
    );
  });

  // Every anonymous caller holds the public user's grant, so no one could be asked to revise it.
  it.each([
    ['an anonymous submission', { id: 'sub1', submittedBy: 'public-user' }],
    ['a submission with no submitter', { id: 'sub1', submittedBy: null }],
  ])('refuses to send back %s', async (_label, record) => {
    mockGetSubmissionRecordById.mockResolvedValue(record);
    const response = await request(app).post(STATUS_PATH).send(REVISE);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(ApiErrorCodes.revision_needs_submitter);
    expect(mockRepo.changeStatus).not.toHaveBeenCalled();
  });

  it('checks the submitter only when the change asks for a revision', async () => {
    await request(app).post(STATUS_PATH).send(ASSIGN);

    expect(mockGetSubmissionRecordById).not.toHaveBeenCalled();
  });

  it("lists who can review the submission's form", async () => {
    const response = await request(app).get(REVIEWERS_PATH);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [REVIEWER] });
    expect(mockAccess.listFormUserIdsHolding).toHaveBeenCalledWith(
      'ws1',
      'f1',
      Permissions.submission_review,
    );
    expect(mockRepo.listReviewUsers).toHaveBeenCalledWith([REVIEWER_ID]);
  });

  it('gates a staff edit of the answers on submission_update', () => {
    expect(mockPermissionCalls).toContainEqual([Permissions.submission_update]);
  });

  it('changes the answers under the caller, from the revision they loaded', async () => {
    const body = {
      data: { a: 2 },
      revisionId: '01a1891a-3246-773c-a7ec-39fca5fea6d0',
      baseRevisionId: '01a1891a-3246-773c-a7ec-39fca5fea6d1',
    };
    mockEditData.mockResolvedValue({ id: 'sub1' });

    const response = await request(app).put('/submissions/sub1/data').send(body);

    expect(response.status).toBe(200);
    expect(mockEditData).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'a1', workspaceId: 'ws1' }),
      'sub1',
      body,
    );
  });

  it('refuses an edit without the revision it was based on', async () => {
    const response = await request(app).put('/submissions/sub1/data').send({ data: {} });

    expect(response.status).toBe(400);
    expect(mockEditData).not.toHaveBeenCalled();
  });

  // The sample stub's data write is gone; staff edits arrive with their own rules.
  it('no longer serves POST review/edits', async () => {
    const response = await request(app).post('/submissions/sub1/review/edits').send({});

    expect(response.status).toBe(404);
  });
});
