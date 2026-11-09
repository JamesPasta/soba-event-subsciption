import { Permissions, printChoiceOf, type PrintFacts } from '../../src/permissions';

const facts = (overrides: Partial<PrintFacts> = {}): PrintFacts => ({
  renderAvailable: true,
  hasTemplate: true,
  permissions: [],
  ...overrides,
});

const READ_ONLY = [Permissions.submission_read];
const UPLOAD_ONLY = [Permissions.submission_print_upload];
const REVIEWER = [...READ_ONLY, ...UPLOAD_ONLY];

describe('printChoiceOf', () => {
  it.each([
    ['a submitter with a stored template', 'template', facts()],
    ['a submitter without one', 'browser', facts({ hasTemplate: false })],
    ['staff with submission_read only', 'template', facts({ permissions: READ_ONLY })],
    ['staff with the upload permission only', 'template', facts({ permissions: UPLOAD_ONLY })],
    ['a reviewer', 'options', facts({ permissions: REVIEWER })],
    ['a reviewer, no template', 'options', facts({ permissions: REVIEWER, hasTemplate: false })],
    ['a form administrator', 'options', facts({ permissions: ['*'], hasTemplate: false })],
  ])('gives %s the %s print', (_label, expected, input) => {
    expect(printChoiceOf(input)).toBe(expected);
  });

  it.each([
    ['a submitter', facts({ renderAvailable: false })],
    ['a reviewer', facts({ renderAvailable: false, permissions: REVIEWER })],
    ['a form administrator', facts({ renderAvailable: false, permissions: ['*'] })],
  ])('gives %s only the browser print without a render backend', (_label, input) => {
    expect(printChoiceOf(input)).toBe('browser');
  });
});
