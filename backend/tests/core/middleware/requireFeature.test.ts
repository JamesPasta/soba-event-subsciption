jest.mock('../../../src/core/db/repos/featureRepo', () => ({
  isFeatureEnabledCached: jest.fn(),
}));

import type { NextFunction, Request, Response } from 'express';
import { isFeatureEnabledCached } from '../../../src/core/db/repos/featureRepo';
import { requireFeature } from '../../../src/core/middleware/requireFeature';
import { NotFoundError } from '../../../src/core/errors';

const enabled = jest.mocked(isFeatureEnabledCached);

const run = async () => {
  const next = jest.fn() as jest.MockedFunction<NextFunction>;
  await requireFeature('files')({} as Request, {} as Response, next);
  return next;
};

describe('requireFeature', () => {
  it('lets a request through while the feature is on', async () => {
    enabled.mockResolvedValue(true);
    expect(await run()).toHaveBeenCalledWith();
  });

  // Off reads exactly like a path that does not exist.
  it('answers 404 with route_not_found while the feature is off', async () => {
    enabled.mockResolvedValue(false);
    const error = (await run()).mock.calls[0][0];
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ message: 'Not found', code: 'route_not_found' });
  });
});
