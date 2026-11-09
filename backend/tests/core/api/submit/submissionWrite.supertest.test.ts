jest.mock('../../../../src/core/container', () => ({
  submissionsApiService: { save: jest.fn(), submit: jest.fn() },
  formVersionService: {},
}));

import express from 'express';
import request from 'supertest';
import { submitRouter } from '../../../../src/core/api/submit';
import { submissionsApiService } from '../../../../src/core/container';
import { coreErrorHandler } from '../../../../src/core/middleware/errorHandler';

const save = jest.mocked(submissionsApiService.save);
const submit = jest.mocked(submissionsApiService.submit);

// Stands in for checkJwt + resolveActorOrPublic, which need a signed token; everything after is real.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actorId = 'public-user';
    req.idpType = 'public';
    next();
  });
  app.use('/api/v1/submit', submitRouter);
  app.use(coreErrorHandler);
  return app;
}

const SUBMISSION_ID = '01a12d03-75a8-73bc-a106-ce3787ee9a1e';
const revisionId = '01a12d03-761e-70a8-9eb2-b5113a6cb3e5';
const baseRevisionId = '01a12d03-7640-748f-b008-2c331de67244';

beforeEach(() => {
  save.mockReset();
  submit.mockReset();
});

describe('POST /submit/submissions/:id/{save,submit}', () => {
  it.each([
    ['save', 'no revision ids', { data: {} }],
    ['submit', 'no revision ids', { data: {} }],
    ['submit', 'only revisionId', { data: {}, revisionId }],
    ['submit', 'only baseRevisionId', { data: {}, baseRevisionId }],
  ])('refuses a %s with %s', async (action, _label, body) => {
    const res = await request(buildApp())
      .post(`/api/v1/submit/submissions/${SUBMISSION_ID}/${action}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
