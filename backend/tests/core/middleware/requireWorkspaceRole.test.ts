import type { NextFunction, Request, Response } from 'express';
import {
  requireWorkspaceManage,
  requireWorkspaceOwner,
  requireWorkspacePeopleRead,
} from '../../../src/core/middleware/requireWorkspaceRole';
import { ForbiddenError } from '../../../src/core/errors';

function makeReq(role?: string | null): Request {
  const coreContext =
    role === undefined
      ? undefined
      : {
          workspaceId: 'ws1',
          actorId: 'actor1',
          actorDisplayLabel: 'Actor One',
          workspaceSource: 'resource:workspace',
          role,
        };
  return { coreContext } as unknown as Request;
}

const res = {} as Response;

// The workspace Jobs routes: the owner alone, not a workspace admin.
describe('requireWorkspaceOwner', () => {
  it('passes for owner', () => {
    const next = jest.fn() as unknown as NextFunction;
    requireWorkspaceOwner(makeReq('owner'), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it.each(['admin', 'member', 'viewer', null])('forbids %s', (role) => {
    const next = jest.fn() as unknown as NextFunction;
    requireWorkspaceOwner(makeReq(role), res, next);
    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.statusCode).toBe(403);
  });

  it('errors when workspace context is missing', () => {
    const next = jest.fn() as unknown as NextFunction;
    requireWorkspaceOwner(makeReq(), res, next);
    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ForbiddenError);
  });
});

describe('requireWorkspaceManage', () => {
  it.each(['owner', 'admin'])('passes for %s', (role) => {
    const next = jest.fn() as unknown as NextFunction;
    requireWorkspaceManage(makeReq(role), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it.each(['member', 'viewer', null])('forbids %s', (role) => {
    const next = jest.fn() as unknown as NextFunction;
    requireWorkspaceManage(makeReq(role), res, next);
    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.statusCode).toBe(403);
  });

  it('errors when workspace context is missing', () => {
    const next = jest.fn() as unknown as NextFunction;
    requireWorkspaceManage(makeReq(), res, next);
    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ForbiddenError);
  });
});

describe('requireWorkspacePeopleRead', () => {
  it.each(['owner', 'admin', 'member'])('passes for %s', (role) => {
    const next = jest.fn() as unknown as NextFunction;
    requireWorkspacePeopleRead(makeReq(role), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it.each(['viewer', 'unknown', null])('forbids %s', (role) => {
    const next = jest.fn() as unknown as NextFunction;
    requireWorkspacePeopleRead(makeReq(role), res, next);
    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.statusCode).toBe(403);
  });

  it('errors when workspace context is missing', () => {
    const next = jest.fn() as unknown as NextFunction;
    requireWorkspacePeopleRead(makeReq(), res, next);
    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ForbiddenError);
  });
});
