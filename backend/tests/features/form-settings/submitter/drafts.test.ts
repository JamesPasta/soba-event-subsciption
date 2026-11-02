jest.mock('../../../../src/core/db/repos/submitterFormRepo', () => ({
  findSubmitterFormFacts: jest.fn(),
}));

import { DraftSaveStatus } from '@soba/lib';
import { getDraftSaveStatus } from '../../../../src/features/form-settings/submitter/drafts';
import { findSubmitterFormFacts } from '../../../../src/core/db/repos/submitterFormRepo';
import { NotFoundError } from '../../../../src/core/errors';

const mockFacts = jest.mocked(findSubmitterFormFacts);
const ctx = { workspaceId: 'ws1', actorDisplayLabel: null };

const facts = (allowSubmitterDrafts: boolean, audienceMode: 'public' | 'protected') => ({
  publishedVersionId: 'v1',
  permissions: [],
  audienceMode,
  audienceIdps: [],
  allowSubmitterDrafts,
  allowSubmitterRevision: false,
});

beforeEach(() => jest.resetAllMocks());

describe('getDraftSaveStatus', () => {
  it("reads the form's facts without a caller", async () => {
    mockFacts.mockResolvedValue(facts(true, 'protected'));
    expect(await getDraftSaveStatus(ctx, 'f1')).toBe(DraftSaveStatus.allowed);
    expect(mockFacts).toHaveBeenCalledWith({ userId: null, workspaceId: 'ws1', formId: 'f1' });
  });

  it.each([
    [false, 'protected', DraftSaveStatus.disabled],
    [true, 'public', DraftSaveStatus.public],
  ] as const)('drafts %s with a %s audience is %s', async (allow, audience, expected) => {
    mockFacts.mockResolvedValue(facts(allow, audience));
    expect(await getDraftSaveStatus(ctx, 'f1')).toBe(expected);
  });

  it('is not found for a form outside the workspace', async () => {
    mockFacts.mockResolvedValue(null);
    await expect(getDraftSaveStatus(ctx, 'f1')).rejects.toBeInstanceOf(NotFoundError);
  });
});
