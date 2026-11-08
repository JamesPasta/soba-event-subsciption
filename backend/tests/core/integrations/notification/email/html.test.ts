import {
  markup,
  toHtmlString,
  type SafeHtml,
} from '../../../../../src/core/integrations/notification/email/html';

describe('markup', () => {
  it('escapes text in content and in a quoted attribute', () => {
    const value = `x" onclick="alert(1)`;
    expect(toHtmlString(markup`<a href="${value}">${'<b>Tom & Jerry</b>'}</a>`)).toBe(
      '<a href="x&quot; onclick=&quot;alert(1)">&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;</a>',
    );
  });

  it('keeps markup it built and escapes each element of a list', () => {
    const bold = markup`<strong>${'A&B'}</strong>`;
    expect(toHtmlString(markup`<p>${bold}${['<i>', markup`<br>`, 'x']}</p>`)).toBe(
      '<p><strong>A&amp;B</strong>&lt;i&gt;<br>x</p>',
    );
  });

  it('renders nothing for null, undefined and false, and still renders 0 and an empty string', () => {
    expect(toHtmlString(markup`[${null}${undefined}${false}${0}${''}]`)).toBe('[0]');
  });

  it('refuses a look-alike of its markup, and true', () => {
    const forged = { toString: () => '<script>alert(1)</script>' } as unknown as SafeHtml;
    expect(() => markup`${forged}`).toThrow(TypeError);
    expect(() => markup`${true as unknown as false}`).toThrow(TypeError);
  });
});
