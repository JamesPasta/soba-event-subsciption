import { FormService } from '../../../src/core/services/formService';
import * as formRepo from '../../../src/core/db/repos/formRepo';
import * as versionRepo from '../../../src/core/db/repos/formVersionRepo';
import * as registry from '../../../src/core/integrations/form-engine/FormEngineRegistry';
import * as workspaceRepo from '../../../src/core/db/repos/workspaceRepo';
import * as formSettings from '../../../src/features/form-settings/create';
import * as engineSchema from '../../../src/core/services/engineSchema';

jest.mock('../../../src/core/db/client', () => ({
  db: { transaction: (cb: (tx: unknown) => unknown) => cb({}) },
}));

jest.mock('../../../src/core/db/repos/formRepo', () => ({
  createForm: jest.fn(),
  findFormAnywhere: jest.fn(),
  formNameExistsInWorkspace: jest.fn(),
  getFormById: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formVersionRepo', () => ({
  createFormVersionDraft: jest.fn(),
  findFormVersionAnywhere: jest.fn(),
  getFormVersionById: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/workspaceRepo', () => ({
  isWorkspaceDisclaimerAccepted: jest.fn(),
}));

jest.mock('../../../src/features/form-settings/create', () => ({
  createFormSettings: jest.fn(),
}));

jest.mock('../../../src/core/services/engineSchema', () => ({
  writeEngineSchema: jest.fn(),
}));

jest.mock('../../../src/core/integrations/form-engine/FormEngineRegistry', () => ({
  getFormEnginePlugins: jest.fn(() => [{ code: 'formio-v5' }]),
  resolveFormEnginePlugin: jest.fn(),
}));

const createForm = formRepo.createForm as unknown as jest.Mock;
const findForm = formRepo.findFormAnywhere as unknown as jest.Mock;
const nameExists = formRepo.formNameExistsInWorkspace as unknown as jest.Mock;
const disclaimerAccepted = workspaceRepo.isWorkspaceDisclaimerAccepted as unknown as jest.Mock;
const createDraft = versionRepo.createFormVersionDraft as unknown as jest.Mock;
const findVersion = versionRepo.findFormVersionAnywhere as unknown as jest.Mock;
const getPlugins = registry.getFormEnginePlugins as unknown as jest.Mock;
const createSettings = formSettings.createFormSettings as unknown as jest.Mock;
const writeSchema = engineSchema.writeEngineSchema as unknown as jest.Mock;

const FORM_ID = '01a11400-0000-7000-8000-000000000001';
const VERSION_ID = '01a11400-0000-7000-8000-000000000002';

const baseCreate = {
  workspaceId: 'ws1',
  actorId: 'a1',
  actorDisplayLabel: 'A',
  name: 'My Form',
};

describe('FormService.create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPlugins.mockReturnValue([{ code: 'formio-v5' }]);
    nameExists.mockResolvedValue(false);
    disclaimerAccepted.mockResolvedValue(true);
    findForm.mockResolvedValue(null);
    findVersion.mockResolvedValue(null);
    writeSchema.mockResolvedValue('engine-ref');
    createForm.mockResolvedValue({ id: FORM_ID, name: 'My Form' });
    createDraft.mockResolvedValue({ id: VERSION_ID, formId: FORM_ID, versionNo: 1 });
  });

  it('rejects creation when the workspace disclaimer is not accepted', async () => {
    disclaimerAccepted.mockResolvedValue(false);
    await expect(new FormService().create(baseCreate)).rejects.toMatchObject({ statusCode: 409 });
    expect(writeSchema).not.toHaveBeenCalled();
    expect(createForm).not.toHaveBeenCalled();
  });

  // The engine document exists before any row that points at it is committed.
  it('writes the first version schema, then the form, version and settings rows', async () => {
    const res = await new FormService().create({
      ...baseCreate,
      id: FORM_ID,
      versionId: VERSION_ID,
    });

    expect(writeSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        engineCode: 'formio-v5',
        formVersionId: VERSION_ID,
        workspaceId: 'ws1',
        title: 'My Form',
        schema: {
          components: [expect.objectContaining({ type: 'button', action: 'submit' })],
        },
      }),
    );
    expect(writeSchema.mock.invocationCallOrder[0]).toBeLessThan(
      createForm.mock.invocationCallOrder[0],
    );
    expect(createForm).toHaveBeenCalledWith(
      expect.objectContaining({ id: FORM_ID, name: 'My Form', formEngineCode: 'formio-v5' }),
      expect.anything(),
    );
    const tx = createForm.mock.calls[0][1];
    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: VERSION_ID, formId: FORM_ID, engineSchemaRef: 'engine-ref' }),
      tx,
    );
    expect(createSettings).toHaveBeenCalledWith(
      { workspaceId: 'ws1', formId: FORM_ID, actorId: 'a1', actorDisplayLabel: 'A' },
      tx,
    );
    expect(res).toEqual({
      form: { id: FORM_ID, name: 'My Form' },
      version: { id: VERSION_ID, formId: FORM_ID, versionNo: 1 },
      created: true,
    });
  });

  it('passes the settings sent with the form to its settings rows', async () => {
    const settings = {
      audience: { inherit: false as const, values: { mode: 'members' as const, idps: [] } },
    };

    await new FormService().create({ ...baseCreate, settings });

    expect(createSettings).toHaveBeenCalledWith(
      expect.objectContaining({ formId: FORM_ID, settings }),
      createForm.mock.calls[0][1],
    );
  });

  it('throws when no form engine plugins are installed', async () => {
    getPlugins.mockReturnValue([]);
    await expect(new FormService().create(baseCreate)).rejects.toThrow(/no form engine plugins/i);
    expect(writeSchema).not.toHaveBeenCalled();
  });

  it('throws when the requested engine is not installed', async () => {
    await expect(
      new FormService().create({ ...baseCreate, formEngineCode: 'nope' }),
    ).rejects.toThrow(/not installed/i);
    expect(writeSchema).not.toHaveBeenCalled();
  });
});
