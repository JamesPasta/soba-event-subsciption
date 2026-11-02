jest.mock('../../../../src/core/container', () => ({
  submissionsApiService: { get: jest.fn() },
  formVersionService: {},
  formsApiService: {},
}));
jest.mock('../../../../src/core/db/repos/submitterSubmissionRepo', () => ({
  findSubmitterSubmission: jest.fn(),
}));
const mockChangeStatus = jest.fn();
jest.mock('../../../../src/core/db/repos/submissionReviewRepo', () => ({
  ...jest.requireActual('../../../../src/core/db/repos/submissionReviewRepo'),
  changeStatus: (...args: unknown[]) => mockChangeStatus(...args),
}));

import express from 'express';
import request from 'supertest';
import {
  ApiErrorCodes,
  SubmissionReviewStatuses,
  SubmissionWorkflowState,
  SubmitterReviewLabels,
} from '@soba/lib';
import { submitRouter } from '../../../../src/core/api/submit';
import { submissionsApiService } from '../../../../src/core/container';
import { findSubmitterSubmission } from '../../../../src/core/db/repos/submitterSubmissionRepo';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';
import { storedSubmission } from './storedSubmission';

const mockRead = jest.mocked(findSubmitterSubmission);
const mockGet = jest.mocked(submissionsApiService.get);

// Stands in for checkJwt + resolveActorOrPublic; the router, guard and @soba/lib rule are real.
function buildApp(caller: 'signedIn' | 'anonymous') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (caller === 'signedIn') {
      req.user = { providerCode: 'idir', profile: { displayLabel: 'Signed In' } } as never;
      req.actorId = 'u1';
    } else {
      req.actorId = 'public-user';
      req.idpType = 'public';
    }
    next();
  });
  app.use('/api/v1/submit', submitRouter);
  app.use(coreErrorHandler);
  return app;
}

const REVISE_PATH = '/api/v1/submit/submissions/s1/revise';
const BODY = { id: '01a1891a-3246-773c-a7ec-39fca5fea6c9' };
const revisable = (overrides: Parameters<typeof storedSubmission>[0] = {}) =>
  storedSubmission({
    workflowState: SubmissionWorkflowState.submitted,
    reviewStatus: SubmitterReviewLabels.submitted,
    statusId: 'st1',
    form: { allowSubmitterRevision: true },
    ...overrides,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRead.mockResolvedValue(revisable());
  mockChangeStatus.mockResolvedValue('changed');
  mockGet.mockResolvedValue({ id: 's1', workflowState: SubmissionWorkflowState.revising } as never);
});

it('sends the owner’s submission back to revise, from the status it read', async () => {
  const res = await request(buildApp('signedIn')).post(REVISE_PATH).send(BODY);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: 's1', workflowState: SubmissionWorkflowState.revising });
  expect(mockChangeStatus).toHaveBeenCalledWith(
    expect.objectContaining({
      id: BODY.id,
      submissionId: 's1',
      fromStatusId: 'st1',
      status: SubmissionReviewStatuses.revising,
      assigneeId: null,
      actorId: 'u1',
      onlyFrom: SubmissionReviewStatuses.submitted,
    }),
  );
});

// A retry after a lost response is answered as made, though the submission is revising by then.
it('answers a retried revise as made', async () => {
  mockRead.mockResolvedValue(
    revisable({
      workflowState: SubmissionWorkflowState.revising,
      reviewStatus: SubmitterReviewLabels.revisionRequested,
    }),
  );
  mockChangeStatus.mockResolvedValue('replayed');

  const res = await request(buildApp('signedIn')).post(REVISE_PATH).send(BODY);

  expect(res.status).toBe(200);
});

it.each([
  ['a collaborator', revisable({ role: 'collaborator' }), 403, ApiErrorCodes.revise_denied],
  [
    'a form whose settings do not let submitters revise',
    revisable({ form: { allowSubmitterRevision: false } }),
    403,
    ApiErrorCodes.revise_disabled,
  ],
])('refuses %s', async (_label, stored, status, code) => {
  mockRead.mockResolvedValue(stored);

  const res = await request(buildApp('signedIn')).post(REVISE_PATH).send(BODY);

  expect(res.status).toBe(status);
  expect(res.body.code).toBe(code);
  expect(mockChangeStatus).not.toHaveBeenCalled();
});

it('never lets an anonymous caller revise', async () => {
  const res = await request(buildApp('anonymous')).post(REVISE_PATH).send(BODY);

  expect(res.status).toBe(401);
  expect(res.body.code).toBe(ApiErrorCodes.revise_denied);
  expect(mockChangeStatus).not.toHaveBeenCalled();
});

it.each([
  ['a reviewer took it up first', 'not_allowed', 409, ApiErrorCodes.revise_closed],
  ['the status moved since the read', 'stale', 409, ApiErrorCodes.revise_closed],
  ['the id is used by another change', 'taken', 409, ApiErrorCodes.status_id_taken],
  ['the submission is gone', 'missing', 404, ApiErrorCodes.submission_not_found],
])('answers when %s', async (_label, outcome, status, code) => {
  mockChangeStatus.mockResolvedValue(outcome);

  const res = await request(buildApp('signedIn')).post(REVISE_PATH).send(BODY);

  expect(res.status).toBe(status);
  expect(res.body.code).toBe(code);
});

it('refuses a submission that was never submitted, without a write', async () => {
  mockRead.mockResolvedValue(
    revisable({ workflowState: 'draft', reviewStatus: null, statusId: null }),
  );

  const res = await request(buildApp('signedIn')).post(REVISE_PATH).send(BODY);

  expect(res.status).toBe(409);
  expect(res.body.code).toBe(ApiErrorCodes.revise_closed);
  expect(mockChangeStatus).not.toHaveBeenCalled();
});

it('refuses a body without a status change id', async () => {
  const res = await request(buildApp('signedIn')).post(REVISE_PATH).send({ id: 'nope' });

  expect(res.status).toBe(400);
});
