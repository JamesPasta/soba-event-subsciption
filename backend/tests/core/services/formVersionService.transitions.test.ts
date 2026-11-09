import { FormVersionService } from '../../../src/core/services/formVersionService';
import * as repo from '../../../src/core/db/repos/formVersionRepo';

jest.mock('../../../src/core/db/client', () => ({
  db: { transaction: (cb: (tx: unknown) => unknown) => cb({}) },
}));

jest.mock('../../../src/core/db/repos/formVersionRepo', () => ({
  getFormVersionById: jest.fn(),
  getFormVersionByIdIncludingDeleted: jest.fn(),
  getPublishedVersionForForm: jest.fn(),
  lockFormVersion: jest.fn(),
  getCurrentFormVersion: jest.fn(),
  updateFormVersionDraft: jest.fn(),
}));

const getById = repo.getFormVersionById as unknown as jest.Mock;
const getByIdInclDeleted = repo.getFormVersionByIdIncludingDeleted as unknown as jest.Mock;
const getPublished = repo.getPublishedVersionForForm as unknown as jest.Mock;
const updateDraft = repo.updateFormVersionDraft as unknown as jest.Mock;
const lock = repo.lockFormVersion as unknown as jest.Mock;
const getCurrent = repo.getCurrentFormVersion as unknown as jest.Mock;

const actor = {
  workspaceId: 'ws1',
  actorId: 'actor-1',
  actorDisplayLabel: 'Author',
  formVersionId: 'v1',
};

const svc = new FormVersionService();

describe('FormVersionService state transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateDraft.mockResolvedValue({ id: 'v1' });
    // The locked row is the row the service read; v1 is the form's current version.
    lock.mockImplementation((workspaceId: string, id: string) => getById(workspaceId, id));
    getCurrent.mockResolvedValue({ id: 'v1' });
  });

  it('publish: draft → published, sets publishedAt/By and demotes the incumbent', async () => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'draft',
      engineSyncStatus: 'ready',
    });
    getPublished.mockResolvedValue({ id: 'old', formId: 'f1', state: 'published' });

    await svc.publish(actor);

    expect(updateDraft).toHaveBeenCalledWith(
      'ws1',
      'old',
      'Author',
      expect.objectContaining({ state: 'archived', publishedAt: null, publishedBy: null }),
      expect.anything(),
    );
    expect(updateDraft).toHaveBeenCalledWith(
      'ws1',
      'v1',
      'Author',
      expect.objectContaining({
        state: 'published',
        publishedBy: 'actor-1',
        publishedAt: expect.any(Date),
        deletedAt: null,
        deletedBy: null,
      }),
      expect.anything(),
    );
  });

  it('publish: rejects when engineSyncStatus is not ready', async () => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'draft',
      engineSyncStatus: 'pending',
    });
    await expect(svc.publish(actor)).rejects.toThrow(/ready/i);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('publish: idempotent no-op when already published', async () => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'published',
      engineSyncStatus: 'ready',
    });
    await svc.publish(actor);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('unpublish: published → archived, clears publishedAt/By', async () => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'published',
      engineSyncStatus: 'ready',
    });
    await svc.unpublish(actor);
    expect(updateDraft).toHaveBeenCalledWith(
      'ws1',
      'v1',
      'Author',
      expect.objectContaining({ state: 'archived', publishedAt: null, publishedBy: null }),
    );
  });

  it('unpublish: rejects a non-published version', async () => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'draft',
      engineSyncStatus: 'ready',
    });
    await expect(svc.unpublish(actor)).rejects.toThrow(/Cannot change/i);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('delete: published → deleted, sets deletedAt/By and clears publishedAt/By', async () => {
    getByIdInclDeleted.mockResolvedValue({ id: 'v1', formId: 'f1', state: 'published' });
    await svc.delete(actor);
    expect(updateDraft).toHaveBeenCalledWith(
      'ws1',
      'v1',
      'Author',
      expect.objectContaining({
        state: 'deleted',
        deletedAt: expect.any(Date),
        deletedBy: 'Author',
        publishedAt: null,
        publishedBy: null,
      }),
    );
  });

  it('delete: rejects re-deleting a deleted version', async () => {
    getByIdInclDeleted.mockResolvedValue({ id: 'v1', formId: 'f1', state: 'deleted' });
    await expect(svc.delete(actor)).rejects.toThrow(/Cannot change/i);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  // Lookups skip deleted rows; the transition table refuses them even when one is read.
  it.each([
    ['publish', () => svc.publish(actor)],
    ['unpublish', () => svc.unpublish(actor)],
  ])('%s: a deleted version stays deleted', async (_label, action) => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'deleted',
      engineSyncStatus: 'ready',
    });
    await expect(action()).rejects.toThrow(/Cannot change form version state from 'deleted'/);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('publish: throws NotFoundError when the version is missing', async () => {
    getById.mockResolvedValue(null);
    await expect(svc.publish(actor)).rejects.toThrow(/not found/i);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('unpublish: throws NotFoundError when the version is missing', async () => {
    getById.mockResolvedValue(null);
    await expect(svc.unpublish(actor)).rejects.toThrow(/not found/i);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('delete: throws NotFoundError when the version is missing', async () => {
    getByIdInclDeleted.mockResolvedValue(null);
    await expect(svc.delete(actor)).rejects.toThrow(/not found/i);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  // A stale designer publishing an older version would archive the version that is live.
  it('publish: refuses a version that is no longer the current one', async () => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'archived',
      engineSyncStatus: 'ready',
    });
    getCurrent.mockResolvedValue({ id: 'v2' });

    await expect(svc.publish(actor)).rejects.toMatchObject({ statusCode: 409 });
    expect(getPublished).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
  });

  // Another version of the form published between this one's read and its write.
  it.each([
    [
      'answers a clash on the one-published-version index with a conflict',
      'form_version_one_published_uq',
      409,
    ],
    [
      'passes any other unique violation through',
      'form_version_workspace_form_version_uq',
      undefined,
    ],
  ])('publish: %s', async (_label, constraint, statusCode) => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'draft',
      engineSyncStatus: 'ready',
    });
    getPublished.mockResolvedValue(null);
    const violation = Object.assign(new Error('duplicate key'), {
      code: '23505',
      severity: 'ERROR',
      constraint,
    });
    updateDraft.mockRejectedValue(violation);

    const outcome = svc.publish(actor);

    if (statusCode) await expect(outcome).rejects.toMatchObject({ statusCode });
    else await expect(outcome).rejects.toBe(violation);
  });
});
