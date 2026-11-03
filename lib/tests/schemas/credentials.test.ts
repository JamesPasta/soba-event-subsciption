import { CredentialFieldsSchema } from '../../src/schemas/credentials';

const input = { label: 'Integration', notes: '', types: ['api'] };
describe('credential fields', () => {
  it('accepts either type or both and trims text', () => {
    for (const types of [['api'], ['web-component'], ['api', 'web-component']]) {
      expect(
        CredentialFieldsSchema.parse({ ...input, label: ' Integration ', notes: ' Vault ', types }),
      ).toEqual({ label: 'Integration', notes: 'Vault', types });
    }
  });
  it.each([
    { ...input, label: ' ' },
    { ...input, label: 'x'.repeat(101) },
    { ...input, notes: 'x'.repeat(1001) },
    { ...input, types: [] },
    { ...input, types: ['api', 'api'] },
    { ...input, types: ['unknown'] },
    { ...input, clientId: 'untrusted' },
  ])('rejects invalid input %j', (body) => {
    expect(CredentialFieldsSchema.safeParse(body).success).toBe(false);
  });
});
