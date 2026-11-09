import { buildSchemaBody } from '../../../src/plugins/formio-v5/formioEngineAdapter';

jest.mock('../../../src/core/db/client', () => ({ db: {} }));

// The real Form.io adapter, as the registry would build it, with a config that never reaches Form.io.
jest.mock('../../../src/core/integrations/form-engine/FormEngineRegistry', () => {
  const actual = jest.requireActual('../../../src/plugins/formio-v5/formioEngineAdapter');
  const config = {
    getRequired: (key: string) => `val-${key}`,
    getOptional: () => undefined,
  };
  return {
    createFormEngineAdapter: (code: string) => {
      if (code !== 'formio-v5') throw new Error(`No engine ${code}`);
      return new actual.FormioEngineAdapter(config);
    },
  };
});

import { FormVersionService } from '../../../src/core/services/formVersionService';

const form = { display: 'form', components: [{ key: 'name', type: 'textfield' }] };
const stored = (formVersionId: string, title: string, schema: Record<string, unknown> = form) =>
  buildSchemaBody({ formVersionId, workspaceId: 'ws1', schema, title });

describe('FormVersionService.schemaHash', () => {
  const svc = new FormVersionService();
  const hashOf = (schema: Record<string, unknown>) =>
    svc.schemaHash({ engineCode: 'formio-v5', schema });

  it('hashes what the engine renders, so versions differing only in identity match', () => {
    expect(hashOf(stored('v2', 'Permit, renamed'))).toBe(hashOf(stored('v1', 'Permit')));
  });

  it('differs when what the engine renders differs', () => {
    expect(hashOf(stored('v2', 'Permit', { ...form, display: 'wizard' }))).not.toBe(
      hashOf(stored('v1', 'Permit')),
    );
  });
});
