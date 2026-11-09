import { FormVersionService } from '../../../src/core/services/formVersionService';
import * as versionRepo from '../../../src/core/db/repos/formVersionRepo';
import * as formRepo from '../../../src/core/db/repos/formRepo';
import * as registry from '../../../src/core/integrations/form-engine/FormEngineRegistry';

jest.mock('../../../src/core/db/client', () => ({
  db: { transaction: (cb: (tx: unknown) => unknown) => cb({}) },
}));

jest.mock('../../../src/core/db/repos/formVersionRepo', () => ({
  getFormVersionById: jest.fn(),
  lockFormVersion: jest.fn(),
  getCurrentFormVersion: jest.fn(),
  updateFormVersionDraft: jest.fn(),
  finishFormVersionProvisioning: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formRepo', () => ({
  getFormById: jest.fn(),
  getFormEngineCodeForForm: jest.fn(),
}));

jest.mock('../../../src/core/integrations/form-engine/FormEngineRegistry', () => ({
  createFormEngineAdapter: jest.fn(),
}));

const getById = versionRepo.getFormVersionById as unknown as jest.Mock;
const updateDraft = versionRepo.updateFormVersionDraft as unknown as jest.Mock;
const lock = versionRepo.lockFormVersion as unknown as jest.Mock;
const getCurrent = versionRepo.getCurrentFormVersion as unknown as jest.Mock;
const finish = versionRepo.finishFormVersionProvisioning as unknown as jest.Mock;
const getFormById = formRepo.getFormById as unknown as jest.Mock;
const getEngineCode = formRepo.getFormEngineCodeForForm as unknown as jest.Mock;
const createAdapter = registry.createFormEngineAdapter as unknown as jest.Mock;

const actor = {
  workspaceId: 'ws1',
  actorId: 'actor-1',
  actorDisplayLabel: 'Author',
  formVersionId: 'v1',
};
const schema = { components: [] };
const CLAIMED_AT = new Date('2026-09-13T10:00:00.000Z');

const svc = new FormVersionService();

describe('FormVersionService provision/getSchema', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateDraft.mockResolvedValue({ id: 'v1', updatedAt: CLAIMED_AT });
    finish.mockResolvedValue({ id: 'v1' });
    getFormById.mockResolvedValue({ id: 'f1', name: 'My Form' });
    getEngineCode.mockResolvedValue('formio-v5');
    // The locked row is the row the service read; v1 is the form's current version.
    lock.mockImplementation((workspaceId: string, id: string) => getById(workspaceId, id));
    getCurrent.mockResolvedValue({ id: 'v1' });
  });

  it('provision: provisions then marks ready with the engine ref', async () => {
    getById.mockResolvedValue({ id: 'v1', formId: 'f1', engineSchemaRef: null, state: 'draft' });
    const upsertSchema = jest.fn().mockResolvedValue({ engineRef: 'eng-1' });
    createAdapter.mockReturnValue({ upsertSchema });

    await svc.provision({ ...actor, schema });

    expect(createAdapter).toHaveBeenCalledWith('formio-v5');
    expect(upsertSchema).toHaveBeenCalledWith({
      formVersionId: 'v1',
      workspaceId: 'ws1',
      schema,
      title: 'My Form',
      signal: expect.any(AbortSignal),
    });
    expect(updateDraft).toHaveBeenCalledWith(
      'ws1',
      'v1',
      'Author',
      expect.objectContaining({ engineSyncStatus: 'provisioning' }),
      expect.anything(),
    );
    expect(finish).toHaveBeenCalledWith(
      'ws1',
      'v1',
      'Author',
      CLAIMED_AT,
      expect.objectContaining({
        engineSchemaRef: 'eng-1',
        engineSyncStatus: 'ready',
        engineSyncError: null,
      }),
    );
  });

  it('provision: on engine reject, records error status and rethrows', async () => {
    getById.mockResolvedValue({ id: 'v1', formId: 'f1', engineSchemaRef: null, state: 'draft' });
    const upsertSchema = jest.fn().mockRejectedValue(new Error('bad schema'));
    createAdapter.mockReturnValue({ upsertSchema });

    await expect(svc.provision({ ...actor, schema })).rejects.toThrow(/bad schema/);

    expect(finish).toHaveBeenCalledWith(
      'ws1',
      'v1',
      'Author',
      CLAIMED_AT,
      expect.objectContaining({ engineSyncStatus: 'error', engineSyncError: 'bad schema' }),
    );
  });

  // A save taken over by a later one must not record its outcome over the later one's.
  it('provision: reports a conflict when another save took the version over', async () => {
    getById.mockResolvedValue({ id: 'v1', formId: 'f1', engineSchemaRef: null, state: 'draft' });
    createAdapter.mockReturnValue({
      upsertSchema: jest.fn().mockResolvedValue({ engineRef: 'eng-1' }),
    });
    finish.mockResolvedValue(null);

    await expect(svc.provision({ ...actor, schema })).rejects.toMatchObject({ statusCode: 409 });
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('provision: rejects when the form has no engine configured', async () => {
    getById.mockResolvedValue({ id: 'v1', formId: 'f1', engineSchemaRef: null, state: 'draft' });
    getEngineCode.mockResolvedValue(null);

    await expect(svc.provision({ ...actor, schema })).rejects.toThrow(/form engine/i);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('getSchema: reads from the engine by ref', async () => {
    getById.mockResolvedValue({ id: 'v1', formId: 'f1', engineSchemaRef: 'eng-1' });
    const readSchema = jest.fn().mockResolvedValue({ components: ['x'] });
    createAdapter.mockReturnValue({ readSchema });

    const result = await svc.getSchema({ workspaceId: 'ws1', formVersionId: 'v1' });

    expect(readSchema).toHaveBeenCalledWith('eng-1');
    expect(result).toEqual({ components: ['x'] });
  });

  it('getSchema: returns null when the version has no engine ref', async () => {
    getById.mockResolvedValue({ id: 'v1', formId: 'f1', engineSchemaRef: null, state: 'draft' });

    const result = await svc.getSchema({ workspaceId: 'ws1', formVersionId: 'v1' });

    expect(result).toBeNull();
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it('provision: throws NotFoundError when the version is missing', async () => {
    getById.mockResolvedValue(null);
    await expect(svc.provision({ ...actor, schema })).rejects.toThrow(/not found/i);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('provision: throws when the engine adapter does not support provisioning', async () => {
    getById.mockResolvedValue({ id: 'v1', formId: 'f1', engineSchemaRef: null, state: 'draft' });
    createAdapter.mockReturnValue({}); // adapter without upsertSchema
    await expect(svc.provision({ ...actor, schema })).rejects.toThrow(/does not support/i);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  // A stale designer must not write to a version someone else has moved on from.
  it('provision: refuses a version that is no longer the current one', async () => {
    getById.mockResolvedValue({ id: 'v1', formId: 'f1', state: 'draft' });
    getCurrent.mockResolvedValue({ id: 'v2' });
    const upsertSchema = jest.fn();
    createAdapter.mockReturnValue({ upsertSchema });

    await expect(svc.provision({ ...actor, schema })).rejects.toMatchObject({ statusCode: 409 });
    expect(upsertSchema).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
  });

  // The engine call runs after the lock is released, so a second save must not start alongside it.
  it('provision: refuses while another save is still writing the schema', async () => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'draft',
      engineSyncStatus: 'provisioning',
      updatedAt: new Date(),
    });
    const upsertSchema = jest.fn();
    createAdapter.mockReturnValue({ upsertSchema });

    await expect(svc.provision({ ...actor, schema })).rejects.toMatchObject({ statusCode: 409 });
    expect(upsertSchema).not.toHaveBeenCalled();
  });

  it('provision: proceeds when an earlier save stopped part way', async () => {
    getById.mockResolvedValue({
      id: 'v1',
      formId: 'f1',
      state: 'draft',
      engineSyncStatus: 'provisioning',
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const upsertSchema = jest.fn().mockResolvedValue({ engineRef: 'eng-1' });
    createAdapter.mockReturnValue({ upsertSchema });

    await svc.provision({ ...actor, schema });
    expect(upsertSchema).toHaveBeenCalled();
  });

  it('provision: refuses a current version that has been published', async () => {
    getById.mockResolvedValue({ id: 'v1', formId: 'f1', state: 'published' });
    const upsertSchema = jest.fn();
    createAdapter.mockReturnValue({ upsertSchema });

    await expect(svc.provision({ ...actor, schema })).rejects.toMatchObject({ statusCode: 409 });
    expect(upsertSchema).not.toHaveBeenCalled();
  });
});
