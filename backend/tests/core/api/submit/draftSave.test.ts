import type { NextFunction, Request, Response } from 'express';
import type { SubmitterFormFacts } from '@soba/lib';
import { requireDraftSave } from '../../../../src/core/api/submit/draftSave';
import { AppError, ForbiddenError } from '../../../../src/core/errors';
import { log } from '../../../../src/core/logging';
import { storedSubmission } from './storedSubmission';

const res = {} as Response;

const run = (form?: Partial<SubmitterFormFacts>) => {
  const req = {
    params: { id: 's1' },
    actorId: 'actor1',
    submitterSubmission: form ? storedSubmission({ form }) : undefined,
  } as unknown as Request;
  const next = jest.fn() as jest.MockedFunction<NextFunction>;
  requireDraftSave(req, res, next);
  return next.mock.calls[0][0];
};

describe('requireDraftSave', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lets a save through when the form accepts drafts', () => {
    expect(run({})).toBeUndefined();
  });

  it.each([
    ['off', { allowSubmitterDrafts: false }, 'Drafts are not enabled for this form', 'disabled'],
    [
      'on a public form',
      { audienceMode: 'public' as const },
      'Drafts are not available on a public form',
      'public',
    ],
  ])('refuses a save with drafts %s, and logs why', (_label, form, message, reason) => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => undefined);
    const error = run(form);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ message });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ formId: 'f1', submissionId: 's1', reason }),
      'Draft save refused',
    );
  });

  it('fails as a server error when nothing was loaded', () => {
    const error = run();
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
  });
});
