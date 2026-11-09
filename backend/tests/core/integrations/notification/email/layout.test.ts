import { markup } from '../../../../../src/core/integrations/notification/email/html';
import type { EmailLanguage } from '../../../../../src/core/integrations/notification/email/language';
import {
  languageSection,
  paragraph,
  renderEmail,
  type EmailParts,
} from '../../../../../src/core/integrations/notification/email/layout';

const WORDS: Readonly<Record<EmailLanguage, { subject: string; text: string }>> = {
  en: { subject: 'Form opens Monday', text: 'The form opens on Monday.' },
  fr: { subject: 'Le formulaire ouvre lundi', text: 'Le formulaire ouvre lundi.' },
};

// An email with no submission: no Confirmation ID, no suffix, no shared block.
const reminder: EmailParts = {
  part: (language) => ({
    subject: WORDS[language].subject,
    section: languageSection(language, [paragraph(WORDS[language].text), null, false]),
  }),
};

describe('renderEmail', () => {
  it('frames an email with no submission behind it, in one language', () => {
    expect(renderEmail(reminder, 'fr')).toEqual({
      subject: 'Le formulaire ouvre lundi',
      body: [
        '<div style="max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#2d2d2d;">',
        '<div lang="fr">',
        '<p style="margin:0 0 16px 0;">Le formulaire ouvre lundi.</p>',
        '</div>',
        '<p style="margin:0;font-size:14px;line-height:20px;color:#474543;"><span lang="fr">Ce message automatique provient de CHEFS. Veuillez ne pas y répondre.</span></p>',
        '</div>',
      ].join('\n'),
      bodyType: 'html',
    });
  });

  it('joins both subjects, adds the suffix once, and keeps the subject on one line', () => {
    const parts: EmailParts = {
      part: (language) => ({ ...reminder.part(language), subject: `${WORDS[language].subject}\n` }),
      subjectSuffix: '(REF1)',
    };
    expect(renderEmail(parts, 'both').subject).toBe(
      'Form opens Monday / Le formulaire ouvre lundi (REF1)',
    );
  });

  it('puts the shared block after the sections and before the footer, given the languages', () => {
    const after = jest.fn((order: readonly EmailLanguage[]) =>
      paragraph(markup`<em>${order.join('+')}</em>`),
    );
    const { body } = renderEmail({ ...reminder, after }, 'both');
    expect(after).toHaveBeenCalledWith(['en', 'fr']);
    const shared = body.indexOf('<em>en+fr</em>');
    expect(shared).toBeGreaterThan(body.indexOf('<div lang="fr">'));
    expect(shared).toBeLessThan(body.indexOf('<span lang="en">This is an automated message'));
  });

  it('says French follows only when the email is in both', () => {
    expect(renderEmail(reminder, 'both').body).toContain(
      '<span lang="fr">(Le français suit)</span>',
    );
    expect(renderEmail(reminder, 'en').body).not.toContain('Le français suit');
  });
});
