jest.mock('../../../src/core/db/repos/membershipRepo', () => ({
  findActorMembership: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formRepo', () => ({
  getFormListContext: jest.fn(),
  getWorkspaceIdForForm: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formVersionRepo', () => ({
  getFormVersionListContext: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/submissionRepo', () => ({
  getSubmissionListContext: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/workspaceRepo', () => ({
  getWorkspaceById: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/documentTemplateRepo', () => ({
  getDocumentTemplateScope: jest.fn(),
}));

import type { NextFunction, Request, Response } from 'express';
import {
  workspaceFromQuery,
  workspaceFromResource,
  workspaceListScope,
  resolveListWorkspaceScope,
} from '../../../src/core/middleware/workspaceContext';
import { findActorMembership } from '../../../src/core/db/repos/membershipRepo';
import { getFormListContext } from '../../../src/core/db/repos/formRepo';
import { getFormVersionListContext } from '../../../src/core/db/repos/formVersionRepo';
import { getSubmissionListContext } from '../../../src/core/db/repos/submissionRepo';
import { getWorkspaceById } from '../../../src/core/db/repos/workspaceRepo';
import { getDocumentTemplateScope } from '../../../src/core/db/repos/documentTemplateRepo';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../src/core/errors';

const MEMBER = { displayLabel: 'Actor One', role: 'owner' };
const NON_MEMBER = { displayLabel: 'Actor One', role: null };

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    actorId: 'actor1',
    query: {},
    params: {},
    body: {},
    header: () => undefined,
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const res: Partial<Response> & { set: jest.Mock } = {
    set: jest.fn().mockReturnThis(),
  };
  return res;
}

beforeEach(() => {
  jest.mocked(findActorMembership).mockReset();
  jest.mocked(getFormListContext).mockReset();
  jest.mocked(getFormVersionListContext).mockReset();
  jest.mocked(getSubmissionListContext).mockReset();
  jest.mocked(getDocumentTemplateScope).mockReset();
});

describe('workspaceFromQuery', () => {
  it('resolves the workspace from the query param and echoes the header', async () => {
    jest.mocked(findActorMembership).mockResolvedValue(MEMBER);
    const req = makeReq({ query: { workspaceId: 'ws1' } as Request['query'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromQuery(req, res as Response, next);

    expect(req.coreContext).toEqual({
      workspaceId: 'ws1',
      actorId: 'actor1',
      actorDisplayLabel: 'Actor One',
      workspaceSource: 'query',
      role: 'owner',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects when the workspaceId query param is missing', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromQuery(req, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(res.set).not.toHaveBeenCalled();
  });

  it('reads the membership on every request', async () => {
    jest
      .mocked(findActorMembership)
      .mockResolvedValueOnce(MEMBER)
      .mockResolvedValueOnce(NON_MEMBER);
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromQuery(
      makeReq({ query: { workspaceId: 'ws1' } as Request['query'] }),
      makeRes() as Response,
      next,
    );
    await workspaceFromQuery(
      makeReq({ query: { workspaceId: 'ws1' } as Request['query'] }),
      makeRes() as Response,
      next,
    );

    expect(findActorMembership).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenNthCalledWith(1);
    expect(next).toHaveBeenNthCalledWith(2, expect.any(ForbiddenError));
  });

  it('rejects with Forbidden when the actor row is gone', async () => {
    jest.mocked(findActorMembership).mockResolvedValue(null);
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromQuery(
      makeReq({ query: { workspaceId: 'ws1' } as Request['query'] }),
      makeRes() as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('rejects with Forbidden when the actor is not a member', async () => {
    jest.mocked(findActorMembership).mockResolvedValue(NON_MEMBER);
    const req = makeReq({ query: { workspaceId: 'ws1' } as Request['query'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromQuery(req, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    expect(res.set).not.toHaveBeenCalled();
  });
});

describe('resolveListWorkspaceScope', () => {
  it('resolves workspace from formId and validates matching workspaceId', async () => {
    jest.mocked(getFormListContext).mockResolvedValue({ workspaceId: 'ws-form' });
    await expect(
      resolveListWorkspaceScope({ formId: 'form1', workspaceId: 'ws-form' }, [
        'formId',
        'workspaceId',
      ]),
    ).resolves.toEqual({ workspaceId: 'ws-form', anchorKind: 'formId', formId: 'form1' });
  });

  it('rejects inconsistent workspaceId for formId anchor', async () => {
    jest.mocked(getFormListContext).mockResolvedValue({ workspaceId: 'ws-form' });
    await expect(
      resolveListWorkspaceScope({ formId: 'form1', workspaceId: 'ws-other' }, [
        'formId',
        'workspaceId',
      ]),
    ).rejects.toThrow(ValidationError);
  });

  it('returns 404 when form anchor is missing', async () => {
    jest.mocked(getFormListContext).mockResolvedValue(null);
    await expect(
      resolveListWorkspaceScope({ formId: 'missing' }, ['formId', 'workspaceId']),
    ).rejects.toThrow(NotFoundError);
  });

  it('resolves from formVersionId and validates formId chain', async () => {
    jest.mocked(getFormVersionListContext).mockResolvedValue({
      workspaceId: 'ws-fv',
      formId: 'form1',
    });
    await expect(
      resolveListWorkspaceScope({ formVersionId: 'fv1', formId: 'form1' }, [
        'formVersionId',
        'formId',
        'workspaceId',
      ]),
    ).resolves.toEqual({ workspaceId: 'ws-fv', anchorKind: 'formVersionId', formId: 'form1' });
  });

  it('rejects inconsistent formId for formVersionId anchor', async () => {
    jest.mocked(getFormVersionListContext).mockResolvedValue({
      workspaceId: 'ws-fv',
      formId: 'form1',
    });
    await expect(
      resolveListWorkspaceScope({ formVersionId: 'fv1', formId: 'other-form' }, [
        'formVersionId',
        'formId',
        'workspaceId',
      ]),
    ).rejects.toThrow(ValidationError);
  });

  it('resolves from submissionId and validates full chain', async () => {
    jest.mocked(getSubmissionListContext).mockResolvedValue({
      workspaceId: 'ws-sub',
      formId: 'form1',
      formVersionId: 'fv1',
    });
    await expect(
      resolveListWorkspaceScope(
        { submissionId: 'sub1', formVersionId: 'fv1', formId: 'form1', workspaceId: 'ws-sub' },
        ['submissionId', 'formVersionId', 'formId', 'workspaceId'],
      ),
    ).resolves.toEqual({ workspaceId: 'ws-sub', anchorKind: 'submissionId', formId: 'form1' });
  });
});

describe('workspaceListScope', () => {
  const formsListScope = workspaceListScope({ anchorOrder: ['formId', 'workspaceId'] });

  it('scopes to workspace from workspaceId anchor and echoes the header', async () => {
    jest.mocked(findActorMembership).mockResolvedValue(MEMBER);
    const req = makeReq({ query: { workspaceId: 'ws1' } as Request['query'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await formsListScope(req, res as Response, next);

    expect(req.listScope).toEqual({
      actorId: 'actor1',
      workspaceIds: ['ws1'],
      selectedWorkspaceId: 'ws1',
    });
    expect(req.coreContext?.workspaceSource).toBe('list:workspaceId');
    expect(req.coreContext?.formId).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('derives workspace from formId anchor and echoes the header', async () => {
    jest.mocked(getFormListContext).mockResolvedValue({ workspaceId: 'ws-form' });
    jest.mocked(findActorMembership).mockResolvedValue(MEMBER);
    const req = makeReq({ query: { formId: 'form1' } as Request['query'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await formsListScope(req, res as Response, next);

    expect(getFormListContext).toHaveBeenCalledWith('form1');
    expect(req.listScope).toEqual({
      actorId: 'actor1',
      workspaceIds: ['ws-form'],
      selectedWorkspaceId: 'ws-form',
    });
    expect(req.coreContext?.workspaceSource).toBe('list:formId');
    expect(req.coreContext?.formId).toBe('form1');
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects with Forbidden when the actor is not a member of the resolved workspace', async () => {
    jest.mocked(findActorMembership).mockResolvedValue(NON_MEMBER);
    const req = makeReq({ query: { workspaceId: 'ws1' } as Request['query'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await formsListScope(req, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    expect(req.listScope).toBeUndefined();
    expect(res.set).not.toHaveBeenCalled();
  });

  it('returns 404 when a formId anchor does not exist', async () => {
    jest.mocked(getFormListContext).mockResolvedValue(null);
    const req = makeReq({ query: { formId: 'missing' } as Request['query'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await formsListScope(req, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(res.set).not.toHaveBeenCalled();
  });
});

describe('workspaceFromResource', () => {
  const { getWorkspaceIdForForm } = jest.requireMock('../../../src/core/db/repos/formRepo') as {
    getWorkspaceIdForForm: jest.Mock;
  };
  const middleware = workspaceFromResource({ kind: 'form', idFrom: 'paramsId' });

  beforeEach(() => {
    getWorkspaceIdForForm.mockReset();
  });

  it('derives the workspace from the resource and echoes the header', async () => {
    getWorkspaceIdForForm.mockResolvedValue('ws9');
    jest.mocked(findActorMembership).mockResolvedValue(MEMBER);
    const req = makeReq({ params: { id: 'form1' } as Request['params'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await middleware(req, res as Response, next);

    expect(getWorkspaceIdForForm).toHaveBeenCalledWith('form1');
    expect(req.coreContext?.workspaceId).toBe('ws9');
    expect(req.coreContext?.formId).toBe('form1');
    expect(req.coreContext?.workspaceSource).toBe('resource:form');
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 404 (NotFoundError) when the resource is missing', async () => {
    getWorkspaceIdForForm.mockResolvedValue(null);
    const req = makeReq({ params: { id: 'missing' } as Request['params'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await middleware(req, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(res.set).not.toHaveBeenCalled();
  });

  it('returns 403 (ForbiddenError) when the actor is not a member of the resource workspace', async () => {
    getWorkspaceIdForForm.mockResolvedValue('ws9');
    jest.mocked(findActorMembership).mockResolvedValue(NON_MEMBER);
    const req = makeReq({ params: { id: 'form1' } as Request['params'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await middleware(req, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    expect(res.set).not.toHaveBeenCalled();
  });
});

// Access checks on a form's resources need the form, not only its workspace.
describe('workspaceFromResource (resources under a form)', () => {
  it('carries the form of a form version', async () => {
    jest
      .mocked(getFormVersionListContext)
      .mockResolvedValue({ workspaceId: 'ws9', formId: 'form1' });
    jest.mocked(findActorMembership).mockResolvedValue(MEMBER);
    const req = makeReq({ params: { id: 'fv1' } as Request['params'] });
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromResource({ kind: 'formVersion', idFrom: 'paramsId' })(
      req,
      makeRes() as Response,
      next,
    );

    expect(req.coreContext).toMatchObject({
      workspaceId: 'ws9',
      formId: 'form1',
      workspaceSource: 'resource:formVersion',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('carries the form of a submission', async () => {
    jest
      .mocked(getSubmissionListContext)
      .mockResolvedValue({ workspaceId: 'ws9', formId: 'form1', formVersionId: 'fv1' });
    jest.mocked(findActorMembership).mockResolvedValue(MEMBER);
    const req = makeReq({ params: { id: 'sub1' } as Request['params'] });
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromResource({ kind: 'submission', idFrom: 'paramsId' })(
      req,
      makeRes() as Response,
      next,
    );

    expect(req.coreContext).toMatchObject({
      workspaceId: 'ws9',
      formId: 'form1',
      workspaceSource: 'resource:submission',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('carries the form of a template', async () => {
    jest
      .mocked(getDocumentTemplateScope)
      .mockResolvedValue({ workspaceId: 'ws9', formId: 'form1' });
    jest.mocked(findActorMembership).mockResolvedValue(MEMBER);
    const req = makeReq({ params: { id: 't1' } as Request['params'] });
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromResource({ kind: 'template', idFrom: 'paramsId' })(
      req,
      makeRes() as Response,
      next,
    );

    expect(getDocumentTemplateScope).toHaveBeenCalledWith('t1');
    expect(req.coreContext).toMatchObject({
      workspaceId: 'ws9',
      formId: 'form1',
      workspaceSource: 'resource:template',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 404 for a template that is missing or on a deleted form version', async () => {
    jest.mocked(getDocumentTemplateScope).mockResolvedValue(null);
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromResource({ kind: 'template', idFrom: 'paramsId' })(
      makeReq({ params: { id: 't1' } as Request['params'] }),
      makeRes() as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
  });

  it('reads a form version id from the query', async () => {
    jest
      .mocked(getFormVersionListContext)
      .mockResolvedValue({ workspaceId: 'ws9', formId: 'form1' });
    jest.mocked(findActorMembership).mockResolvedValue(MEMBER);
    const req = makeReq({ query: { formVersionId: 'fv1' } as Request['query'] });
    const next = jest.fn() as unknown as NextFunction;

    await workspaceFromResource({ kind: 'formVersion', idFrom: 'queryFormVersionId' })(
      req,
      makeRes() as Response,
      next,
    );

    expect(getFormVersionListContext).toHaveBeenCalledWith('fv1');
    expect(req.coreContext).toMatchObject({ workspaceId: 'ws9', formId: 'form1' });
    expect(next).toHaveBeenCalledWith();
  });
});

describe('workspaceFromResource (kind: workspace)', () => {
  const middleware = workspaceFromResource({ kind: 'workspace', idFrom: 'paramsId' });

  beforeEach(() => {
    jest.mocked(getWorkspaceById).mockReset();
  });

  it('returns 404 when the workspace does not exist (not 403)', async () => {
    jest.mocked(getWorkspaceById).mockResolvedValue(null);
    const req = makeReq({ params: { id: 'missing-ws' } as Request['params'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await middleware(req, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(findActorMembership).not.toHaveBeenCalled();
    expect(res.set).not.toHaveBeenCalled();
  });

  it('returns 403 when the workspace exists but the actor is not a member', async () => {
    jest.mocked(getWorkspaceById).mockResolvedValue({ id: 'ws1' });
    jest.mocked(findActorMembership).mockResolvedValue(NON_MEMBER);
    const req = makeReq({ params: { id: 'ws1' } as Request['params'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await middleware(req, res as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    expect(res.set).not.toHaveBeenCalled();
  });

  it('resolves and echoes the header when the workspace exists and the actor is a member', async () => {
    jest.mocked(getWorkspaceById).mockResolvedValue({ id: 'ws1' });
    jest.mocked(findActorMembership).mockResolvedValue(MEMBER);
    const req = makeReq({ params: { id: 'ws1' } as Request['params'] });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await middleware(req, res as Response, next);

    expect(req.coreContext?.workspaceId).toBe('ws1');
    expect(req.coreContext?.formId).toBeUndefined();
    expect(req.coreContext?.workspaceSource).toBe('resource:workspace');
    expect(next).toHaveBeenCalledWith();
  });
});
