import type { Request, Response } from 'express';
import { requireFeatureAvailable } from '../../../src/core/middleware/requireFeatureAvailable';
import * as availability from '../../../src/core/services/featureAvailabilityService';
import { NotFoundError } from '../../../src/core/errors';
import { Features } from '../../../src/core/db/codes';

jest.mock('../../../src/core/services/featureAvailabilityService', () => ({
  isFeatureAvailable: jest.fn(),
}));

const isFeatureAvailable = availability.isFeatureAvailable as unknown as jest.Mock;

// Run the middleware and resolve with whatever it passes to next() (undefined = passed).
const runGuard = (
  middleware: ReturnType<typeof requireFeatureAvailable>,
  req: Partial<Request>,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    middleware(req as Request, {} as Response, (err?: unknown) => resolve(err)).catch(reject);
  });

describe('requireFeatureAvailable', () => {
  beforeEach(() => {
    isFeatureAvailable.mockReset();
  });

  it('passes when the feature is available for the workspace in core context', async () => {
    isFeatureAvailable.mockResolvedValue(true);

    const err = await runGuard(requireFeatureAvailable(Features.files), {
      coreContext: { workspaceId: 'w1' },
    } as Partial<Request>);

    expect(err).toBeUndefined();
    expect(isFeatureAvailable).toHaveBeenCalledWith(Features.files, { workspaceId: 'w1' });
  });

  it('404s (as if unmounted) when the feature is unavailable for the scope', async () => {
    isFeatureAvailable.mockResolvedValue(false);

    const err = await runGuard(requireFeatureAvailable(Features.files), {
      coreContext: { workspaceId: 'w1' },
    } as Partial<Request>);

    expect(err).toBeInstanceOf(NotFoundError);
    expect(err).toMatchObject({ message: 'Not found', code: 'route_not_found' });
  });

  it('fails loud (not a silent 404) when mounted before workspace resolution', async () => {
    // Default resolver with no coreContext = a mis-ordered mount; surface it instead of a 404.
    const err = await runGuard(requireFeatureAvailable(Features.files), {} as Partial<Request>);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/must run after workspace resolution/);
    expect(isFeatureAvailable).not.toHaveBeenCalled();
  });

  it('sources the scope from a custom resolver (e.g. a form id from params)', async () => {
    isFeatureAvailable.mockResolvedValue(true);

    await runGuard(
      requireFeatureAvailable(Features.files, (req) => ({ formId: req.params.id })),
      { params: { id: 'f9' } } as unknown as Partial<Request>,
    );

    expect(isFeatureAvailable).toHaveBeenCalledWith(Features.files, { formId: 'f9' });
  });
});
