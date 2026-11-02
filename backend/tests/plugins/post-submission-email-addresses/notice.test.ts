import { cleanName } from '../../../src/core/integrations/notification/emailText';
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
  it('names the form, the confirmation ID, the link and the workspace', () => {
    expect(buildNotice(submission, 'https://soba.example/link')).toEqual({
      subject: 'Submission received: Permit application',
      body: [
        'A submission to "Permit application" was received.',
        '',
        'Confirmation ID: ABCD1234',
        '',
        'View it (sign-in required): https://soba.example/link',
        '',
        'You are receiving this because the team for this form in the "Licensing" workspace set up this notice.',
      ].join('\n'),
    });
  });

  it('leaves the link line out when there is no link', () => {
    expect(buildNotice(submission, null).body).not.toContain('View it');
  });

  it('cleans the names it uses', () => {
    const notice = buildNotice({ ...submission, formName: 'A\nB' }, null);
    expect(notice.subject).toBe('Submission received: A B');
  });
});
