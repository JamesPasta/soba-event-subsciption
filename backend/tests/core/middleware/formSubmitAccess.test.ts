import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  requireSignedInSubmitter,
  requireSubmissionDelete,
  requireSubmissionRead,
  requireSubmissionWrite,
} from '../../../src/core/middleware/formSubmitAccess';
import type { SubmitterSubmission } from '../../../src/core/db/repos/submitterSubmissionRepo';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '../../../src/core/errors';
import { storedSubmission } from '../api/submit/storedSubmission';

const res = {} as Response;

function makeReq(opts: { authed?: boolean; stored?: SubmitterSubmission }): Request {
  return {
    actorId: opts.authed ? 'u1' : 'public-user',
    user: opts.authed ? ({ providerCode: 'idir', profile: {} } as Express.User) : undefined,
    idpType: opts.authed ? undefined : 'public',
    params: { id: 's1' },
    submitterSubmission: opts.stored,
  } as unknown as Request;
}

const run = (guard: RequestHandler, req: Request) => {
  const next = jest.fn() as jest.MockedFunction<NextFunction>;
  void guard(req, res, next);
  return next;
};

describe('submit guards decide from the stored read', () => {
  it('lets a grant holder read', () => {
    expect(
      run(requireSubmissionRead, makeReq({ authed: true, stored: storedSubmission() })),
    ).toHaveBeenCalledWith();
  });

  it('refuses a read without a grant, 403 signed in and 401 anonymous', () => {
    const stored = storedSubmission({ role: null });
    expect(run(requireSubmissionRead, makeReq({ authed: true, stored }))).toHaveBeenCalledWith(
      expect.any(ForbiddenError),
    );
    expect(run(requireSubmissionRead, makeReq({ stored }))).toHaveBeenCalledWith(
      expect.any(UnauthorizedError),
    );
  });

  it.each([
    ['a grant and the submit permission', storedSubmission(), undefined],
    [
      'a grant without the submit permission',
      storedSubmission({ form: { permissions: [] } }),
      ForbiddenError,
    ],
    ['the submit permission without a grant', storedSubmission({ role: null }), ForbiddenError],
    [
      'a submitted submission, which is held, not refused',
      storedSubmission({ workflowState: 'submitted' }),
      undefined,
    ],
  ])('decides a write for %s', (_label, stored, refusal) => {
    const next = run(requireSubmissionWrite, makeReq({ authed: true, stored }));
    if (refusal) expect(next).toHaveBeenCalledWith(expect.any(refusal));
    else expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ['the signed-in owner of a draft', true, storedSubmission(), undefined],
    ['a collaborator', true, storedSubmission({ role: 'collaborator' }), ForbiddenError],
    ['the public user', false, storedSubmission(), UnauthorizedError],
    [
      'the owner, once submitted',
      true,
      storedSubmission({ workflowState: 'submitted' }),
      ConflictError,
    ],
  ])('decides a delete by %s', (_label, authed, stored, refusal) => {
    const next = run(requireSubmissionDelete, makeReq({ authed, stored }));
    if (refusal) expect(next).toHaveBeenCalledWith(expect.any(refusal));
    else expect(next).toHaveBeenCalledWith();
  });

  it('says why a submitted submission cannot be deleted', () => {
    const stored = storedSubmission({ workflowState: 'submitted' });
    const next = run(requireSubmissionDelete, makeReq({ authed: true, stored }));
    expect(next.mock.calls[0][0]).toMatchObject({
      message: 'Submission is submitted and can no longer be deleted',
    });
  });

  it.each([requireSubmissionRead, requireSubmissionWrite, requireSubmissionDelete])(
    'fails as a server error when nothing was loaded (%#)',
    (guard) => {
      const error = run(guard, makeReq({ authed: true })).mock.calls[0][0];
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
    },
  );

  it('lets a signed-in caller list their own forms and submissions', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    requireSignedInSubmitter(makeReq({ authed: true }), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('refuses the public caller a list of their own, with a 401', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    requireSignedInSubmitter(makeReq({}), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'sign_in_required' }));
  });
});
