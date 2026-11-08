import type { EmailLanguage } from '../../../../../src/core/integrations/notification/email/language';
import {
  defineSubmissionEmail,
  renderSubmissionEmail,
  type SubmissionEmailFacts,
} from '../../../../../src/core/integrations/notification/email/submissionEmail';
import { designerSubmissionUrl } from '../../../../../src/core/integrations/notification/email/url';

const template = defineSubmissionEmail({
  en: {
    subject: ({ form }) => `${form} Submission`,
    sentence: ({ form }) => `There is a new ${form} submission.`,
    linkText: 'View this submission',
  },
  fr: {
    subject: ({ form }) => `Soumission ${form}`,
    sentence: ({ form }) => `Il y a une nouvelle soumission ${form}.`,
    linkText: 'Voir cette soumission',
  },
});

const facts = (overrides: Partial<SubmissionEmailFacts> = {}): SubmissionEmailFacts => ({
  formName: 'Permit application',
  confirmationCode: 'ABCD1234',
  link: (language: EmailLanguage) =>
    designerSubmissionUrl('https://soba.example/designer', language, 'f1', 's1'),
  ...overrides,
});

const FOOTER_EN = 'This is an automated message from CHEFS. Please do not reply.';

describe('renderSubmissionEmail', () => {
  it('renders one language: the Confirmation ID, the sentence, the link and the footer', () => {
    expect(renderSubmissionEmail(template, facts(), 'en')).toEqual({
      subject: 'Permit application Submission (ABCD1234)',
      body: [
        '<div style="max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#2d2d2d;">',
        '<div lang="en">',
        '<p style="margin:0 0 16px 0;">Confirmation ID: <strong>ABCD1234</strong></p>',
        '<p style="margin:0 0 16px 0;">There is a new Permit application submission.</p>',
        '<p style="margin:0 0 16px 0;"><a href="https://soba.example/designer/en/build/f1/submissions/s1" style="color:#255a90;text-decoration:underline;">View this submission</a></p>',
        '</div>',
        `<p style="margin:0;font-size:14px;line-height:20px;color:#474543;"><span lang="en">${FOOTER_EN}</span></p>`,
        '</div>',
      ].join('\n'),
      bodyType: 'html',
    });
  });

  it('renders French on its own, in French throughout', () => {
    const { subject, body } = renderSubmissionEmail(template, facts(), 'fr');
    expect(subject).toBe('Soumission Permit application (ABCD1234)');
    expect(body).toContain('<div lang="fr">');
    expect(body).toContain('Numéro de confirmation : <strong>ABCD1234</strong>');
    expect(body).toContain('href="https://soba.example/designer/fr/build/f1/submissions/s1"');
    expect(body).toContain('<span lang="fr">Ce message automatique provient de CHEFS.');
    expect(body).not.toContain('lang="en"');
    expect(body).not.toContain('Le français suit');
  });

  it('renders both as one message: French follows, English, a divider, French, then one footer', () => {
    const { subject, body } = renderSubmissionEmail(template, facts(), 'both');
    expect(subject).toBe(
      'Permit application Submission / Soumission Permit application (ABCD1234)',
    );
    const order = [
      '<span lang="fr">(Le français suit)</span>',
      '<div lang="en">',
      'href="https://soba.example/designer/en/build/f1/submissions/s1"',
      '<table role="presentation"',
      '<div lang="fr">',
      'href="https://soba.example/designer/fr/build/f1/submissions/s1"',
      `<span lang="en">${FOOTER_EN}</span><br><span lang="fr">`,
    ].map((part) => body.indexOf(part));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('shows the comment once, after the sections, with its line breaks and its markup as text', () => {
    const { body } = renderSubmissionEmail(
      template,
      facts({ comment: 'Line one\n<b>two</b>\r\nthree https://example.ca' }),
      'both',
    );
    const comment =
      '<strong>Comments / Commentaires :</strong><br>Line one<br>&lt;b&gt;two&lt;/b&gt;<br>three https://example.ca';
    expect(body.split(comment)).toHaveLength(2);
    expect(body.indexOf(comment)).toBeGreaterThan(body.indexOf('<div lang="fr">'));
    expect(body.indexOf(comment)).toBeLessThan(body.indexOf(FOOTER_EN));
    expect(renderSubmissionEmail(template, facts({ comment: 'Thanks' }), 'en').body).toContain(
      '<strong>Comments:</strong><br>Thanks',
    );
  });

  it('leaves out a blank comment and a missing link', () => {
    const { body } = renderSubmissionEmail(
      template,
      facts({ comment: ' \n ', link: () => null }),
      'en',
    );
    expect(body).not.toContain('Comments');
    expect(body).not.toContain('<a ');
  });

  it('cleans the form name, and escapes it in the body only', () => {
    const cleaned = renderSubmissionEmail(
      template,
      facts({ formName: 'A\nB https://evil.example' }),
      'en',
    );
    expect(cleaned.subject).toBe('A B [link removed] Submission (ABCD1234)');
    expect(cleaned.body).toContain('There is a new A B [link removed] submission.');

    const marked = renderSubmissionEmail(
      template,
      facts({ formName: '<b>Fees</b> & "Permits"' }),
      'en',
    );
    expect(marked.subject).toBe('<b>Fees</b> & "Permits" Submission (ABCD1234)');
    expect(marked.body).toContain(
      'There is a new &lt;b&gt;Fees&lt;/b&gt; &amp; &quot;Permits&quot; submission.',
    );
  });

  it('keeps the longest subject on one line and inside the provider limit', () => {
    const smile = String.fromCodePoint(0x1f600);
    const { subject } = renderSubmissionEmail(
      template,
      facts({ formName: smile.repeat(500) }),
      'both',
    );
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.length).toBeLessThanOrEqual(998);
    expect(subject.endsWith('(ABCD1234)')).toBe(true);
  });
});
