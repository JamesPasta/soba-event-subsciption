import { cleanName, escapeHtml } from '../../../src/core/integrations/notification/emailText';
import {
  buildNotice,
  designerLink,
} from '../../../src/plugins/post-submission-email-addresses/notice';

const submission = {
  id: 's1',
  formId: 'f1',
  formName: 'Permit application',
  workspaceId: 'w1',
  workspaceName: 'Licensing',
  confirmationCode: 'ABCD1234',
};

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
});

describe('escapeHtml', () => {
  it('escapes markup and quotes and leaves other text alone', () => {
    expect(escapeHtml(`<a href="x">Tom's & Co</a> café`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; Co&lt;/a&gt; café',
    );
  });
});

describe('designerLink', () => {
  it("points at the submission in the designer, whatever the base's trailing slash", () => {
    const expected = 'https://soba.example/designer/en/build/f1/submissions/s1';
    expect(designerLink('https://soba.example/designer', submission)).toBe(expected);
    expect(designerLink('https://soba.example/designer/', submission)).toBe(expected);
  });

  it('is left out when the designer URL is not set', () => {
    expect(designerLink(undefined, submission)).toBeNull();
  });
});

describe('buildNotice', () => {
  it('names the confirmation ID and the form, and links to the submission', () => {
    expect(buildNotice(submission, 'https://soba.example/link')).toEqual({
      subject: 'Permit application Submission',
      body: [
        '<p>Confirmation ID: <strong>ABCD1234</strong></p>',
        '<p>There is a new Permit application submission. Please sign in to review it.</p>',
        '<p><a href="https://soba.example/link">View this submission</a></p>',
      ].join('\n'),
      bodyType: 'html',
    });
  });

  it('leaves the link out when there is no link', () => {
    expect(buildNotice(submission, null).body).toBe(
      [
        '<p>Confirmation ID: <strong>ABCD1234</strong></p>',
        '<p>There is a new Permit application submission. Please sign in to review it.</p>',
      ].join('\n'),
    );
  });

  it('cleans the form name', () => {
    const notice = buildNotice({ ...submission, formName: 'A\nB' }, null);
    expect(notice.subject).toBe('A B Submission');
  });

  it('escapes the form name and the link in the body, not in the subject', () => {
    const notice = buildNotice(
      { ...submission, formName: '<b>Fees</b> & "Permits"' },
      'https://soba.example/link?a=1&b="x"',
    );
    expect(notice.subject).toBe('<b>Fees</b> & "Permits" Submission');
    expect(notice.body).toContain(
      'There is a new &lt;b&gt;Fees&lt;/b&gt; &amp; &quot;Permits&quot; submission.',
    );
    expect(notice.body).toContain('href="https://soba.example/link?a=1&amp;b=&quot;x&quot;"');
  });
});
