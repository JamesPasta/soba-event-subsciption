import { describe, it, expect } from 'vitest';
import { printBaseName, printFileName } from '@/src/features/templates/printFileName';

const ID = '01a0dc24-1f2e-7a3b-8c4d-5e6f7a8b9c0d';

describe('printBaseName', () => {
  it('names a submitted submission by its form and confirmation code', () => {
    expect(printBaseName({ id: ID, formName: 'Permit', confirmationCode: 'ABC123' })).toBe(
      'Permit ABC123',
    );
  });

  it('falls back to the id before there is a code, and to the id alone without a form name', () => {
    expect(printBaseName({ id: ID, formName: 'Permit', confirmationCode: null })).toBe(
      `Permit ${ID}`,
    );
    expect(printBaseName({ id: ID, confirmationCode: 'ABC123' })).toBe('ABC123');
  });

  it('replaces characters a file name cannot hold and stays within the report name limit', () => {
    expect(printBaseName({ id: ID, formName: 'A/B: "C"?', confirmationCode: 'X1' })).toBe(
      'A-B- -C- X1',
    );
    expect(
      printBaseName({ id: ID, formName: 'x'.repeat(300), confirmationCode: 'X1' }),
    ).toHaveLength(255);
  });

  it('does not cut a character in half at the report name limit', () => {
    const name = printBaseName({
      id: ID,
      formName: `${'x'.repeat(254)}\u{1F600}`,
      confirmationCode: 'X1',
    });
    expect(name).toBe('x'.repeat(254));
  });
});

describe('printFileName', () => {
  it.each([
    ['application/pdf', 'Permit ABC123.pdf'],
    ['application/pdf; charset=binary', 'Permit ABC123.pdf'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Permit ABC123.docx',
    ],
    ['text/html', 'Permit ABC123.html'],
    ['application/octet-stream', 'Permit ABC123'],
    ['', 'Permit ABC123'],
  ])('names a %j document %s', (type, name) => {
    expect(printFileName('Permit ABC123', new Blob(['x'], { type }))).toBe(name);
  });
});
