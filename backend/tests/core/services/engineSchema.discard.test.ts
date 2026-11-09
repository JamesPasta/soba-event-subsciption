import { discardLostEngineSchema } from '../../../src/core/services/engineSchema';
import * as registry from '../../../src/core/integrations/form-engine/FormEngineRegistry';
import { log } from '../../../src/core/logging';

jest.mock('../../../src/core/integrations/form-engine/FormEngineRegistry', () => ({
  createFormEngineAdapter: jest.fn(),
}));

const createAdapter = registry.createFormEngineAdapter as unknown as jest.Mock;

describe('discardLostEngineSchema', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the written document when the committed version refers to another', async () => {
    const deleteSchema = jest.fn().mockResolvedValue(undefined);
    createAdapter.mockReturnValue({ deleteSchema });

    await discardLostEngineSchema('formio-v5', { id: 'v1', engineSchemaRef: 'committed' }, 'mine');

    expect(createAdapter).toHaveBeenCalledWith('formio-v5');
    expect(deleteSchema).toHaveBeenCalledWith('mine');
  });

  it('keeps the written document when the committed version refers to it', async () => {
    const deleteSchema = jest.fn();
    createAdapter.mockReturnValue({ deleteSchema });

    await discardLostEngineSchema('formio-v5', { id: 'v1', engineSchemaRef: 'mine' }, 'mine');

    expect(deleteSchema).not.toHaveBeenCalled();
  });

  it('logs a failed delete instead of failing the replay', async () => {
    const failure = new Error('engine down');
    createAdapter.mockReturnValue({ deleteSchema: jest.fn().mockRejectedValue(failure) });
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => undefined);

    await expect(
      discardLostEngineSchema('formio-v5', { id: 'v1', engineSchemaRef: 'committed' }, 'mine'),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure, formVersionId: 'v1', engineRef: 'mine' }),
      expect.any(String),
    );
    warn.mockRestore();
  });
});
