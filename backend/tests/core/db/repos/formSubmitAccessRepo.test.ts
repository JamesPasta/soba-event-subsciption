jest.mock('../../../../src/core/db/repos/submitterFormRepo', () => ({
  findSubmitterFormFacts: jest.fn(),
}));

import { hasFormSubmitAccess } from '../../../../src/core/db/repos/formSubmitAccessRepo';
import { findSubmitterFormFacts } from '../../../../src/core/db/repos/submitterFormRepo';

const mockFacts = jest.mocked(findSubmitterFormFacts);
const target = { workspaceId: 'ws1', formId: 'f1' };

const facts = (overrides = {}) => ({
  publishedVersionId: 'v1',
  permissions: [] as string[],
  audienceMode: 'members' as const,
  audienceIdps: [] as string[],
  allowSubmitterDrafts: false,
  allowSubmitterRevision: false,
  ...overrides,
});

beforeEach(() => mockFacts.mockReset());

describe('hasFormSubmitAccess', () => {
  it("reads a signed-in caller's permissions on the form", async () => {
    mockFacts.mockResolvedValue(facts({ permissions: ['submission_create'] }));
    const allowed = await hasFormSubmitAccess(
      target,
      { actorId: 'u1', idpCode: 'idir' },
      'submission_create',
    );
    expect(allowed).toBe(true);
    expect(mockFacts).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'ws1', formId: 'f1' });
  });

  it('reads no permissions for the public user, which belongs to no workspace', async () => {
    mockFacts.mockResolvedValue(facts({ audienceMode: 'public' }));
    const allowed = await hasFormSubmitAccess(
      target,
      { actorId: 'public-user', idpCode: 'public' },
      'submission_create',
    );
    expect(allowed).toBe(true);
    expect(mockFacts).toHaveBeenCalledWith({ userId: null, workspaceId: 'ws1', formId: 'f1' });
  });

  it.each([
    ['with no provider', { actorId: 'u1', idpCode: null }, 'u1'],
    ['with no actor', { actorId: null, idpCode: 'idir' }, null],
  ])('reads permissions for a caller %s only when it has an actor', async (_l, caller, userId) => {
    mockFacts.mockResolvedValue(facts());
    await hasFormSubmitAccess(target, caller, 'submission_create');
    expect(mockFacts).toHaveBeenCalledWith({ userId, workspaceId: 'ws1', formId: 'f1' });
  });

  it('refuses when the form is not in the workspace', async () => {
    mockFacts.mockResolvedValue(null);
    expect(
      await hasFormSubmitAccess(target, { actorId: 'u1', idpCode: 'idir' }, 'submission_create'),
    ).toBe(false);
  });
});
