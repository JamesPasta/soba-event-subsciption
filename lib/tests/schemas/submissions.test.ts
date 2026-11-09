import {
  ListMySubmissionsResponseSchema,
  OpenSubmissionBodySchema,
  SubmissionDataBodySchema,
  SubmitSubmissionBodySchema,
} from '../../src/schemas/submissions';

// The client mints the submission id and it is the record's identity, so only a v7 uuid is accepted.
describe('OpenSubmissionBodySchema', () => {
  it.each([
    ['nil', '00000000-0000-0000-0000-000000000000'],
    ['max', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ['v4', '3b241101-e2bb-4255-8caf-4136c566a962'],
    ['non-uuid', 'not-a-uuid'],
  ])('rejects a %s id', (_label, id) => {
    expect(OpenSubmissionBodySchema.safeParse({ id, formId: 'f1' }).success).toBe(false);
  });

  // A retried open must match the row Postgres stores, which spells ids lower-case.
  it('lower-cases the ids an open names', () => {
    expect(
      OpenSubmissionBodySchema.parse({
        id: '01A12D03-75A8-73BC-A106-CE3787EE9A1E',
        formId: '01A12D03-1D06-764D-B997-599461E8AB19',
        formVersionId: '01A12D03-7640-748F-B008-2C331DE67244',
      }),
    ).toEqual({
      id: '01a12d03-75a8-73bc-a106-ce3787ee9a1e',
      formId: '01a12d03-1d06-764d-b997-599461e8ab19',
      formVersionId: '01a12d03-7640-748f-b008-2c331de67244',
    });
  });

  it('accepts a v7 id', () => {
    const id = '01a08da2-5717-7348-a6a7-ee556b9980b3';
    expect(OpenSubmissionBodySchema.safeParse({ id, formId: 'f1' }).success).toBe(true);
  });
});

const revisionId = '01a0c65a-3d6d-7430-9d4e-7548062a8e04';
const baseRevisionId = '01a0c65a-39de-738f-87e6-84774616e6c5';

describe('SubmissionDataBodySchema', () => {
  it('requires both revision ids', () => {
    expect(SubmissionDataBodySchema.safeParse({ data: {} }).success).toBe(false);
    expect(SubmissionDataBodySchema.safeParse({ data: {}, revisionId }).success).toBe(false);
    expect(
      SubmissionDataBodySchema.safeParse({ data: {}, revisionId, baseRevisionId }).success,
    ).toBe(true);
  });

  it('rejects a revision id that is not v7', () => {
    const v4 = '3b241101-e2bb-4255-8caf-4136c566a962';
    expect(
      SubmissionDataBodySchema.safeParse({ data: {}, revisionId: v4, baseRevisionId }).success,
    ).toBe(false);
  });
});

describe('SubmitSubmissionBodySchema', () => {
  it.each([
    ['no revision ids', { data: {} }, false],
    ['both revision ids', { data: {}, revisionId, baseRevisionId }, true],
    ['only revisionId', { data: {}, revisionId }, false],
    ['only baseRevisionId', { data: {}, baseRevisionId }, false],
  ])('%s', (_label, body, ok) => {
    expect(SubmitSubmissionBodySchema.safeParse(body).success).toBe(ok);
  });
});

describe('ListMySubmissionsResponseSchema', () => {
  const row = {
    id: 's1',
    formId: 'f1',
    formName: 'Permit',
    formVersionId: 'v1',
    workflowState: 'draft',
    role: 'owner',
    headRevisionId: null,
    currentRevisionNo: 0,
    submittedAt: null,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    confirmationCode: null,
    reviewStatus: null,
  };
  const form = {
    id: 'f1',
    name: 'Permit',
    workspaceId: 'w1',
    workspaceName: 'Roads',
    publishedVersionId: 'v1',
    permissions: ['submission_create'],
    audienceMode: 'members',
    audienceIdps: [],
    allowSubmitterDrafts: true,
    allowSubmitterRevision: false,
  };
  const page = { offset: 0, limit: 10, total: 1 };
  const response = (over: Record<string, unknown> = {}) => ({
    items: [row],
    forms: [form],
    page,
    filters: {},
    sort: 'updatedAt:desc',
    ...over,
  });

  it.each([
    ['a row with no head revision yet, and its form', response(), true],
    ['a page with no forms list', { ...response(), forms: undefined }, false],
    [
      'a row without its form version',
      response({ items: [{ ...row, formVersionId: undefined }] }),
      false,
    ],
    [
      'a row without its revision number',
      response({ items: [{ ...row, currentRevisionNo: undefined }] }),
      false,
    ],
    [
      'a row sent back to revise, in the label its submitter sees',
      response({
        items: [{ ...row, workflowState: 'revising', reviewStatus: 'revisionRequested' }],
      }),
      true,
    ],
    // The submitter is told the review in its own labels, never its statuses.
    [
      'a row with a review status code',
      response({ items: [{ ...row, reviewStatus: 'ASSIGNED' }] }),
      false,
    ],
  ])('%s', (_label, body, ok) => {
    expect(ListMySubmissionsResponseSchema.safeParse(body).success).toBe(ok);
  });
});
