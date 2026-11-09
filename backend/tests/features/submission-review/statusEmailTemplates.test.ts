import type { EmailLanguage } from '../../../src/core/integrations/notification/email/language';
import {
  renderSubmissionEmail,
  type SubmissionEmailFacts,
  type SubmissionEmailTemplate,
} from '../../../src/core/integrations/notification/email/submissionEmail';
import { designerSubmissionUrl } from '../../../src/core/integrations/notification/email/url';
import {
  ASSIGNED_EMAIL,
  COMPLETED_EMAIL,
  REVISING_EMAIL,
} from '../../../src/features/submission-review/statusEmailTemplates';

const facts: SubmissionEmailFacts = {
  formName: 'Permit application',
  confirmationCode: 'K7M2Q9XA',
  link: (language: EmailLanguage) =>
    designerSubmissionUrl('https://soba.example', language, 'f1', 's1'),
};

const englishBody = (sentence: string): string =>
  [
    '<div style="max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#2d2d2d;">',
    '<div lang="en">',
    '<p style="margin:0 0 16px 0;">Confirmation ID: <strong>K7M2Q9XA</strong></p>',
    `<p style="margin:0 0 16px 0;">${sentence}</p>`,
    '<p style="margin:0 0 16px 0;"><a href="https://soba.example/en/build/f1/submissions/s1" style="color:#255a90;text-decoration:underline;">View this submission</a></p>',
    '</div>',
    '<p style="margin:0;font-size:14px;line-height:20px;color:#474543;"><span lang="en">This is an automated message from CHEFS. Please do not reply.</span></p>',
    '</div>',
  ].join('\n');

const TEMPLATES: ReadonlyArray<[string, SubmissionEmailTemplate, string, string]> = [
  [
    'assigned',
    ASSIGNED_EMAIL,
    'Permit application Submission Assignment (K7M2Q9XA)',
    'You have been assigned to a Permit application submission. Please sign in to review it.',
  ],
  [
    'revising',
    REVISING_EMAIL,
    'Permit application Submission Revision Requested (K7M2Q9XA)',
    'You have been asked to revise your Permit application submission. Please sign in to make your changes and submit it again.',
  ],
  [
    'completed',
    COMPLETED_EMAIL,
    'Permit application Submission Completed (K7M2Q9XA)',
    'The review of your Permit application submission is complete.',
  ],
];

describe('status email templates', () => {
  it.each(TEMPLATES)('words the %s email in English', (_name, template, subject, sentence) => {
    expect(renderSubmissionEmail(template, facts, 'en')).toEqual({
      subject,
      body: englishBody(sentence),
      bodyType: 'html',
    });
  });

  it.each(TEMPLATES)('words the %s email in French', (_name, template) => {
    const { subject, body } = renderSubmissionEmail(template, facts, 'fr');
    expect(subject).toMatch(/\S.* \(K7M2Q9XA\)$/);
    expect(body).toContain('ID de confirmation : <strong>K7M2Q9XA</strong>');
    expect(body).toContain('Permit application');
    expect(body).toContain('>Voir cette soumission</a>');
  });
});
