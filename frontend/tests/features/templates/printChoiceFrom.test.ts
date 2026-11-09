import { describe, it, expect } from 'vitest';
import { printChoiceFrom } from '@/src/features/templates/data/useSubmissionPrint';

const WITH_TEMPLATE = { items: [{ id: 'tpl-1' }], renderAvailable: true };
const REVIEWER = ['submission_read', 'submission_print_upload'];

describe('printChoiceFrom', () => {
  it.each([
    ['the feature list', { allowed: null, facts: undefined, permissions: [] }],
    ['the facts', { allowed: true, facts: undefined, permissions: [] }],
    ['the permissions', { allowed: true, facts: WITH_TEMPLATE, permissions: null }],
  ])('is null while %s load', (_label, read) => {
    expect(printChoiceFrom({ ...read, failed: false })).toBeNull();
  });

  it('prints from the browser when the app has no template print', () => {
    expect(
      printChoiceFrom({ allowed: false, facts: undefined, failed: false, permissions: REVIEWER }),
    ).toBe('browser');
  });

  it('prints from the browser when the facts failed, whatever they said before', () => {
    expect(
      printChoiceFrom({ allowed: true, facts: WITH_TEMPLATE, failed: true, permissions: REVIEWER }),
    ).toBe('browser');
  });

  it('decides from the facts and permissions once they are read', () => {
    const read = { allowed: true, facts: WITH_TEMPLATE, failed: false };
    expect(printChoiceFrom({ ...read, permissions: [] })).toBe('template');
    expect(printChoiceFrom({ ...read, permissions: REVIEWER })).toBe('options');
    expect(
      printChoiceFrom({
        ...read,
        facts: { items: [], renderAvailable: true },
        permissions: [],
      }),
    ).toBe('browser');
  });
});
