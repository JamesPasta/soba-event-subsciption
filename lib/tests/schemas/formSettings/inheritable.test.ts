import { z } from 'zod';
import { inheritableSettingsSchemas } from '../../../src/schemas/formSettings';

const schemas = inheritableSettingsSchemas(z.object({ colour: z.enum(['red', 'blue']) }));

describe('inheritableSettingsSchemas', () => {
  it.each([
    ['inherit', { inherit: true, version: 3 }],
    ['own values', { inherit: false, values: { colour: 'red' }, version: 3 }],
  ])('accepts a form body that chooses %s', (_label, body) => {
    expect(schemas.formBody.safeParse(body).success).toBe(true);
  });

  // Mixing the two choices would leave one of them silently ignored, and a save without the version
  // it started from could overwrite a change it never saw.
  it.each([
    ['inherit with values', { inherit: true, values: { colour: 'red' }, version: 3 }],
    ['own values missing', { inherit: false, version: 3 }],
    [
      'own values that fail the group schema',
      { inherit: false, values: { colour: 'green' }, version: 3 },
    ],
    ['no choice', { version: 3 }],
    ['no version', { inherit: true }],
    ['a version that is not a positive whole number', { inherit: true, version: 0 }],
  ])('refuses a form body with %s', (_label, body) => {
    expect(schemas.formBody.safeParse(body).success).toBe(false);
  });

  // A new form has no version to send.
  it('takes a new form choice without a version', () => {
    expect(schemas.formChoice.safeParse({ inherit: true }).success).toBe(true);
    expect(schemas.formChoice.safeParse({ inherit: true, version: 1 }).success).toBe(false);
  });

  it('reads a form that inherits, with no values of its own', () => {
    const read = {
      inherit: true,
      own: null,
      workspace: { colour: 'blue' },
      effective: { colour: 'blue' },
      version: 1,
    };
    expect(schemas.form.parse(read)).toEqual(read);
  });

  it('reads and saves the workspace values with their version', () => {
    expect(schemas.workspace.safeParse({ values: { colour: 'red' }, version: 2 }).success).toBe(
      true,
    );
    expect(schemas.workspace.safeParse({ values: { colour: 'red' } }).success).toBe(false);
    expect(schemas.workspace.safeParse({ values: {}, version: 2 }).success).toBe(false);
  });
});
