import {
  buildSchemaBody,
  FormioEngineAdapter,
  renderedFormioSchema,
} from '../../../src/plugins/formio-v5/formioEngineAdapter';
import type { PluginConfigReader } from '../../../src/core/config/pluginConfig';
import { schemaHashOf } from '../../../src/core/services/schemaHash';

const adapter = new FormioEngineAdapter({
  getRequired: (key: string) => `val-${key}`,
  getOptional: () => undefined,
} as unknown as PluginConfigReader);

const name = { key: 'name', type: 'textfield', validate: { required: true } };
const submit = { key: 'submit', type: 'button' };
const form = {
  display: 'form',
  settings: { wizard: false },
  components: [name, submit],
  properties: { decimalSeparator: ',' },
};

/** The document Form.io stores for a form version: the form, plus its identity and metadata. */
const stored = (formVersionId: string, title: string, schema: Record<string, unknown> = form) => ({
  ...buildSchemaBody({ formVersionId, workspaceId: 'ws1', schema, title }),
  type: 'form',
  access: [{ type: 'read_all', roles: [`role-${formVersionId}`] }],
  submissionAccess: [],
});

describe('renderedFormioSchema', () => {
  it('keeps what the renderer reads, and nothing that identifies the document', () => {
    expect(renderedFormioSchema(stored('v1', 'Permit'))).toEqual(form);
  });

  it('leaves out a rendered field the document lacks', () => {
    expect(renderedFormioSchema({ name: 'soba-v1', components: [] })).toEqual({ components: [] });
  });

  it('reads properties holding only what SOBA adds as none', () => {
    const plain = { display: form.display, settings: form.settings, components: form.components };
    expect(renderedFormioSchema(stored('v1', 'Permit', plain))).toEqual(plain);
  });

  it('keeps the submit action', () => {
    const posting = { ...form, action: 'https://example.test/intake' };
    expect(renderedFormioSchema(stored('v1', 'Permit', posting))).toEqual(posting);
  });
});

describe('a Form.io schema hash', () => {
  const hashOf = (doc: Record<string, unknown>) => schemaHashOf(doc, adapter);

  it('is equal for two versions of one form, whatever their stored identity', () => {
    const v1 = stored('v1', 'Permit');
    const v2 = stored('v2', 'Permit, renamed');
    expect(v2).not.toEqual(v1);
    expect(hashOf(v2)).toBe(hashOf(v1));
  });

  it.each([
    ['the display', { ...form, display: 'wizard' }],
    ['the settings', { ...form, settings: { wizard: true } }],
    ['a validation rule', { ...form, components: [{ ...name, validate: {} }, submit] }],
    ['the component order', { ...form, components: [submit, name] }],
    ['a form property', { ...form, properties: { decimalSeparator: '.' } }],
    ['the submit action', { ...form, action: 'https://example.test/intake' }],
  ])('differs when it changes %s', (_label, changed) => {
    expect(hashOf(stored('v2', 'Permit', changed))).not.toBe(hashOf(stored('v1', 'Permit')));
  });
});
