import {
  AddSubmissionNoteBodySchema,
  canChangeReviewStatus,
  nextSubmissionStatuses,
  SUBMISSION_NOTE_MAX_LENGTH,
  SubmissionReviewSchema,
  submitterReviewLabelOf,
  UpdateSubmissionStatusBodySchema,
} from '../../src/schemas/submissionReview';

const NOTE_ID = '01a1891a-3246-773c-a7ec-39fca5fea6bf';
const STATUS_ID = '01a1891a-3246-773c-a7ec-39fca5fea6c0';
const FROM_STATUS_ID = '01a1891a-3246-773c-a7ec-39fca5fea6c1';
const USER_ID = '01a1891a-3246-773c-a7ec-39fca5fea6c2';
const STATUS_BODY = { id: STATUS_ID, fromStatusId: FROM_STATUS_ID };
const EMPTY_REVIEW = { allowStatusUpdates: false, statusHistory: [], notes: [], editHistory: [] };

describe('submission review schemas', () => {
  it('accepts a review with no status yet', () => {
    expect(SubmissionReviewSchema.safeParse(EMPTY_REVIEW).success).toBe(true);
  });

  it('names an assignee by id and display name', () => {
    const change = {
      id: 's1',
      status: 'ASSIGNED',
      changedAt: '2026-10-01T10:00:00.000Z',
      updatedBy: 'Ada Lovelace',
    };
    const review = (assignee: unknown) =>
      SubmissionReviewSchema.safeParse({
        ...EMPTY_REVIEW,
        statusHistory: [{ ...change, assignee }],
      }).success;

    expect(review({ id: 'u1', displayName: 'Grace Hopper', email: 'grace@example.com' })).toBe(
      true,
    );
    expect(review({ id: 'u1', displayName: 'Grace Hopper', email: null })).toBe(true);
    expect(review(null)).toBe(true);
    expect(review('Grace Hopper')).toBe(false);
  });

  it('trims a note and keeps the id the client chose', () => {
    expect(AddSubmissionNoteBodySchema.parse({ id: NOTE_ID, text: '  Checked  ' })).toEqual({
      id: NOTE_ID,
      text: 'Checked',
    });
  });

  it('takes a note up to the limit', () => {
    expect(
      AddSubmissionNoteBodySchema.safeParse({
        id: NOTE_ID,
        text: 'x'.repeat(SUBMISSION_NOTE_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it.each([
    ['a blank note', { id: NOTE_ID, text: '   ' }],
    ['a note over the limit', { id: NOTE_ID, text: 'x'.repeat(SUBMISSION_NOTE_MAX_LENGTH + 1) }],
    ['a missing id', { text: 'Checked' }],
    ['an id that is not a UUID', { id: 'n1', text: 'Checked' }],
  ])('refuses %s', (_label, body) => {
    expect(AddSubmissionNoteBodySchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['SUBMITTED', ['ASSIGNED', 'COMPLETED', 'REVISING']],
    ['ASSIGNED', ['ASSIGNED', 'COMPLETED', 'REVISING']],
    ['COMPLETED', ['ASSIGNED', 'REVISING']],
    ['REVISING', ['ASSIGNED', 'COMPLETED']],
  ] as const)('moves a submission from %s to %j', (from, to) => {
    expect(nextSubmissionStatuses(from)).toEqual(to);
  });

  it('moves nothing before the submission is submitted', () => {
    expect(nextSubmissionStatuses(undefined)).toEqual([]);
  });

  it.each(['SUBMITTED', 'ASSIGNED', 'COMPLETED'] as const)(
    'lets reviewers change %s only while status updates are on',
    (status) => {
      expect(canChangeReviewStatus(true, status)).toBe(true);
      expect(canChangeReviewStatus(false, status)).toBe(false);
    },
  );

  it('lets reviewers end a revision whatever the settings', () => {
    expect(canChangeReviewStatus(true, 'REVISING')).toBe(true);
    expect(canChangeReviewStatus(false, 'REVISING')).toBe(true);
  });

  it('takes an assignee with Assigned and none with Completed', () => {
    expect(
      UpdateSubmissionStatusBodySchema.safeParse({
        ...STATUS_BODY,
        status: 'ASSIGNED',
        assigneeId: USER_ID,
      }).success,
    ).toBe(true);
    expect(
      UpdateSubmissionStatusBodySchema.safeParse({
        ...STATUS_BODY,
        status: 'COMPLETED',
        assigneeId: null,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['Assigned and no assignee', { ...STATUS_BODY, status: 'ASSIGNED', assigneeId: null }],
    ['Completed and an assignee', { ...STATUS_BODY, status: 'COMPLETED', assigneeId: USER_ID }],
    ['no current status', { id: STATUS_ID, status: 'COMPLETED', assigneeId: null }],
    ['an unknown status', { ...STATUS_BODY, status: 'CLOSED', assigneeId: null }],
    [
      'an email attachment and no comment',
      { ...STATUS_BODY, status: 'COMPLETED', assigneeId: null, attachCommentToEmail: true },
    ],
    [
      'a comment over the note limit',
      {
        ...STATUS_BODY,
        status: 'COMPLETED',
        assigneeId: null,
        comment: 'x'.repeat(SUBMISSION_NOTE_MAX_LENGTH + 1),
      },
    ],
  ])('refuses a status change with %s', (_label, value) => {
    expect(UpdateSubmissionStatusBodySchema.safeParse(value).success).toBe(false);
  });

  it('takes a trimmed comment to attach to the email', () => {
    expect(
      UpdateSubmissionStatusBodySchema.parse({
        ...STATUS_BODY,
        status: 'REVISING',
        assigneeId: null,
        comment: '  Please attach the declaration.  ',
        attachCommentToEmail: true,
      }),
    ).toMatchObject({ comment: 'Please attach the declaration.', attachCommentToEmail: true });
  });

  it.each([
    ['SUBMITTED', 'submitted'],
    ['ASSIGNED', 'inReview'],
    ['COMPLETED', 'completed'],
    ['REVISING', 'revisionRequested'],
  ] as const)('tells the submitter %s as %s', (status, label) => {
    expect(submitterReviewLabelOf(status)).toBe(label);
  });

  it('tells the submitter nothing before the submission is submitted', () => {
    expect(submitterReviewLabelOf(null)).toBeNull();
  });
});
