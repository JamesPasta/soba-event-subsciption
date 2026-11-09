import {
  AudienceSchema,
  FormAudienceSettingsSchema,
  SetFormAudienceSettingsBodySchema,
} from '../../../src/schemas/formSettings';

describe('AudienceSchema', () => {
  it.each([
    ['public', { mode: 'public', idps: [] }],
    ['protected with a provider', { mode: 'protected', idps: ['azureidir'] }],
    ['members', { mode: 'members', idps: [] }],
  ])('accepts %s', (_label, audience) => {
    expect(AudienceSchema.safeParse(audience).success).toBe(true);
  });

  // People are never part of the audience, so protected with no provider would admit nobody, and
  // providers on any other mode would be stored but never used.
  it.each([
    ['protected with no providers', { mode: 'protected', idps: [] }],
    ['a blank provider', { mode: 'protected', idps: [' '] }],
    ['public with providers', { mode: 'public', idps: ['azureidir'] }],
    ['members with providers', { mode: 'members', idps: ['azureidir'] }],
    ['an unknown mode', { mode: 'none', idps: [] }],
    ['no providers list', { mode: 'public' }],
  ])('rejects %s', (_label, audience) => {
    expect(AudienceSchema.safeParse(audience).success).toBe(false);
  });

  it('accepts up to 20 providers and trims them', () => {
    const idps = Array.from({ length: 20 }, (_, i) => ` idp${i} `);
    expect(AudienceSchema.parse({ mode: 'protected', idps })).toEqual({
      mode: 'protected',
      idps: idps.map((code) => code.trim()),
    });
    expect(AudienceSchema.safeParse({ mode: 'protected', idps: [...idps, 'idp20'] }).success).toBe(
      false,
    );
  });
});

describe('form audience settings', () => {
  it('saves either inherit or the form audience', () => {
    expect(SetFormAudienceSettingsBodySchema.safeParse({ inherit: true, version: 1 }).success).toBe(
      true,
    );
    expect(
      SetFormAudienceSettingsBodySchema.safeParse({
        inherit: false,
        values: { mode: 'members', idps: [] },
        version: 1,
      }).success,
    ).toBe(true);
    expect(
      SetFormAudienceSettingsBodySchema.safeParse({
        inherit: false,
        values: { mode: 'protected', idps: [] },
        version: 1,
      }).success,
    ).toBe(false);
  });

  it('reads a form that inherits', () => {
    const read = {
      inherit: true,
      own: null,
      workspace: { mode: 'protected', idps: ['azureidir'] },
      effective: { mode: 'protected', idps: ['azureidir'] },
      version: 1,
    };
    expect(FormAudienceSettingsSchema.parse(read)).toEqual(read);
  });
});
