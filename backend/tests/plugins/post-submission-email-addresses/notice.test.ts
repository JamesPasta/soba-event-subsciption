import { renderSubmissionEmail } from '../../../src/core/integrations/notification/email/submissionEmail';
import { designerSubmissionUrl } from '../../../src/core/appLinks';
import { buildNotice, NOTICE } from '../../../src/plugins/post-submission-email-addresses/notice';

const DESIGNER = 'https://soba.example/designer';

const submission = {
  id: 's1',
  formId: 'f1',
  formName: 'Permit application',
  workspaceId: 'w1',
  workspaceName: 'Licensing',
  confirmationCode: 'ABCD1234',
};

describe('the notice', () => {
  it('names the Confirmation ID and the form, asks for sign-in, and links to the submission', () => {
    const notice = renderSubmissionEmail(
      NOTICE,
      {
        formName: submission.formName,
        confirmationCode: submission.confirmationCode,
        link: (language) => designerSubmissionUrl(DESIGNER, language, 'f1', 's1'),
      },
      'en',
    );
    expect(notice).toEqual({
      subject: 'Permit application Submission (ABCD1234)',
      body: [
        '<div style="max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#2d2d2d;">',
        '<div lang="en">',
        '<p style="margin:0 0 16px 0;">Confirmation ID: <strong>ABCD1234</strong></p>',
        '<p style="margin:0 0 16px 0;">There is a new Permit application submission. Please sign in to review it.</p>',
        '<p style="margin:0 0 16px 0;"><a href="https://soba.example/designer/en/build/f1/submissions/s1" style="color:#255a90;text-decoration:underline;">View this submission</a></p>',
        '</div>',
        '<p style="margin:0;font-size:14px;line-height:20px;color:#474543;"><span lang="en">This is an automated message from CHEFS. Please do not reply.</span></p>',
        '</div>',
      ].join('\n'),
      bodyType: 'html',
    });
  });

  it('goes out in both languages, each linking to the designer in its own language', () => {
    const { subject, body } = buildNotice(submission, DESIGNER);
    expect(subject).toBe(
      'Permit application Submission / Soumission : Permit application (ABCD1234)',
    );
    expect(body).toContain('There is a new Permit application submission.');
    expect(body).toContain('Il y a une nouvelle soumission pour Permit application.');
    expect(body).toContain('href="https://soba.example/designer/en/build/f1/submissions/s1"');
    expect(body).toContain('href="https://soba.example/designer/fr/build/f1/submissions/s1"');
    expect(body).toContain('>Voir cette soumission</a>');
  });

  it('leaves the link out when the designer URL is not set', () => {
    const { body } = buildNotice(submission, undefined);
    expect(body).toContain('Please sign in to review it.');
    expect(body).not.toContain('<a ');
  });
});
