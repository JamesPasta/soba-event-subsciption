import { describe, it, expect } from 'vitest';
import { fillTemplate } from '@/src/shared/util/stringUtils';

describe('fillTemplate', () => {
  it('fills each named placeholder', () => {
    expect(
      fillTemplate('Continue {form}, last updated {updated}', { form: 'Permit', updated: 'today' }),
    ).toBe('Continue Permit, last updated today');
  });

  it('leaves a placeholder it has no value for', () => {
    expect(fillTemplate('Start {form} in {workspace}', { form: 'Permit' })).toBe(
      'Start Permit in {workspace}',
    );
  });

  it('keeps `$` in a value literal', () => {
    expect(fillTemplate('Start {form}', { form: 'Fees $& $$ $1' })).toBe('Start Fees $& $$ $1');
  });
});
