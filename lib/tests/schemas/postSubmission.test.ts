import { SettingsVersionSchema } from '../../src/schemas/formSettings/inheritable';
import {
  POST_SUBMISSION_EMAIL_MAX_ADDRESSES,
  PostSubmissionActionValuesSchema,
  PostSubmissionEmailAddressSchema,
  PostSubmissionEmailAddressesOptionsSchema,
  PostSubmissionFormActionListSchema,
  PostSubmissionLogOptionsSchema,
  postSubmissionSettingsSchemas,
} from '../../src/schemas/postSubmission';

const values = { enabled: true, options: { to: ['a@example.com'] } };
const schemas = postSubmissionSettingsSchemas(PostSubmissionActionValuesSchema);

describe('post-submission settings', () => {
  it('takes version 0 for a scope with no saved row, and no negative or fractional version', () => {
    const parse = (version: number) => schemas.workspace.safeParse({ values, version }).success;
    expect(parse(0)).toBe(true);
    expect(parse(-1)).toBe(false);
    expect(parse(1.5)).toBe(false);
  });

  it('leaves the shared groups needing a positive version', () => {
    expect(SettingsVersionSchema.safeParse(0).success).toBe(false);
  });

  it("takes a form's choice to inherit or keep its own values, and refuses a mix", () => {
    const parse = (body: unknown) => schemas.formBody.safeParse(body).success;
    expect(parse({ inherit: true, version: 0 })).toBe(true);
    expect(parse({ inherit: false, values, version: 3 })).toBe(true);
    expect(parse({ inherit: true, values, version: 3 })).toBe(false);
    expect(parse({ inherit: false, version: 3 })).toBe(false);
  });

  it("reads a form's view with its own values null while it inherits", () => {
    const view = { inherit: true, workspace: values, own: null, effective: values, version: 0 };
    expect(schemas.form.parse(view)).toEqual(view);
  });

  it("lists a form's actions with whether its workspace can set each", () => {
    const view = { inherit: true, workspace: values, own: null, effective: values, version: 0 };
    const item = { code: 'post-submission-log', name: 'Log', scopes: ['workspace', 'form'] };
    expect(
      PostSubmissionFormActionListSchema.safeParse({
        actions: [{ ...item, workspaceConfigurable: false, settings: view }],
      }).success,
    ).toBe(true);
    expect(
      PostSubmissionFormActionListSchema.safeParse({ actions: [{ ...item, settings: view }] })
        .success,
    ).toBe(false);
  });
});

describe('the email action options', () => {
  it('trims, lower-cases and de-duplicates the addresses', () => {
    expect(
      PostSubmissionEmailAddressesOptionsSchema.parse({
        to: [' Team@Example.com ', 'team@example.com', 'b@example.com'],
      }),
    ).toEqual({ to: ['team@example.com', 'b@example.com'] });
  });

  it('takes 1 to 100 valid addresses and nothing else', () => {
    const many = Array.from(
      { length: POST_SUBMISSION_EMAIL_MAX_ADDRESSES + 1 },
      (_, index) => `a${index}@example.com`,
    );
    const parse = (options: unknown) =>
      PostSubmissionEmailAddressesOptionsSchema.safeParse(options).success;
    expect(parse({ to: [] })).toBe(false);
    expect(parse({ to: many })).toBe(false);
    expect(parse({ to: many.slice(1) })).toBe(true);
    expect(parse({ to: ['not an address'] })).toBe(false);
    expect(parse({ to: ['a@example.com'], cc: [] })).toBe(false);
  });

  it('checks one address as the field does before it becomes a chip', () => {
    expect(PostSubmissionEmailAddressSchema.parse('  Jane@Gov.BC.ca ')).toBe('jane@gov.bc.ca');
    expect(PostSubmissionEmailAddressSchema.safeParse('jane@').success).toBe(false);
  });
});

describe('the log action options', () => {
  it('takes an optional note of up to 200 characters', () => {
    const parse = (options: unknown) => PostSubmissionLogOptionsSchema.safeParse(options).success;
    expect(parse({})).toBe(true);
    expect(parse({ note: 'x'.repeat(200) })).toBe(true);
    expect(parse({ note: 'x'.repeat(201) })).toBe(false);
    expect(parse({ other: 1 })).toBe(false);
  });
});
