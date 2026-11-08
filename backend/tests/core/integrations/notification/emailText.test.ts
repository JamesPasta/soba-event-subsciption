import {
  cleanName,
  withoutTrailingSlashes,
} from '../../../../src/core/integrations/notification/emailText';

describe('cleanName', () => {
  it('drops control and format characters and keeps one line', () => {
    const rightToLeftOverride = String.fromCodePoint(0x202e);
    expect(cleanName(`Permit\r\nBcc: x@example.com${rightToLeftOverride}\tform`)).toBe(
      'Permit Bcc: x@example.com form',
    );
  });

  it('caps the length', () => {
    expect(cleanName('x'.repeat(500))).toHaveLength(200);
  });

  it('cuts by character, never through an emoji', () => {
    const smile = String.fromCodePoint(0x1f600);
    const cut = cleanName(`${'x'.repeat(199)}${smile}${smile}`);
    expect(Array.from(cut)).toHaveLength(200);
    expect(cut.endsWith(smile)).toBe(true);
  });

  it.each([
    ['Re-verify at https://evil.example/login now', 'Re-verify at [link removed] now'],
    ['See www.evil.example for details', 'See [link removed] for details'],
    ['[Click](http://evil.example)', '[Click]([link removed]'],
    ['Licensing B.C. renewal', 'Licensing B.C. renewal'],
  ])('removes links from %j', (name, cleaned) => {
    expect(cleanName(name)).toBe(cleaned);
  });

  it('drops every trailing slash and nothing else', () => {
    expect(withoutTrailingSlashes('https://soba.example/designer//')).toBe(
      'https://soba.example/designer',
    );
    expect(withoutTrailingSlashes('https://soba.example/designer')).toBe(
      'https://soba.example/designer',
    );
  });
});
