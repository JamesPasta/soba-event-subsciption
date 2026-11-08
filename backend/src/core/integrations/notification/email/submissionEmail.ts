import { cleanName } from '../emailText';
import { markup, type SafeHtml } from './html';
import type { EmailLanguage, EmailLanguages } from './language';
import {
  languageSection,
  link,
  paragraph,
  renderEmail,
  withLineBreaks,
  type RenderedEmail,
} from './layout';
import type { SafeUrl } from './url';

/** What a submission email's words are given: the form's name, already made fit for an email. */
export interface SubmissionEmailVars {
  form: string;
}

/** One language's words for a submission email. The block adds the Confirmation ID and the rest. */
export interface SubmissionEmailCopy {
  /** Plain text; the Confirmation ID is added after it. */
  subject: (vars: SubmissionEmailVars) => string;
  /** The one sentence that says what happened. */
  sentence: (vars: SubmissionEmailVars) => string;
  linkText: string;
}

/** A submission email's words in English and French. */
export type SubmissionEmailTemplate = Readonly<Record<EmailLanguage, SubmissionEmailCopy>>;

export const defineSubmissionEmail = (template: SubmissionEmailTemplate): SubmissionEmailTemplate =>
  template;

/** The submission an email is about. */
export interface SubmissionEmailFacts {
  formName: string;
  confirmationCode: string;
  /** The link for a language, or null when there is none. */
  link: (language: EmailLanguage) => SafeUrl | null;
  /** The reviewer's comment as typed, when it goes in the email. */
  comment?: string | null;
}

const COPY: Readonly<Record<EmailLanguage, { confirmationId: string; comments: string }>> = {
  en: { confirmationId: 'Confirmation ID:', comments: 'Comments:' },
  fr: { confirmationId: 'Numéro de confirmation :', comments: 'Commentaires :' },
};
const BOTH_COMMENTS = 'Comments / Commentaires :';

// Shown once, in no particular language, whatever languages the email is in.
const commentBlock = (order: readonly EmailLanguage[], comment: string): SafeHtml =>
  paragraph(
    markup`<strong>${order.length > 1 ? BOTH_COMMENTS : COPY[order[0]].comments}</strong><br>${withLineBreaks(comment)}`,
  );

/**
 * An email about a submission: in each language its Confirmation ID, one sentence and the link,
 * then the comment. The subject ends with the Confirmation ID.
 */
export const renderSubmissionEmail = (
  template: SubmissionEmailTemplate,
  facts: SubmissionEmailFacts,
  languages: EmailLanguages,
): RenderedEmail => {
  const vars = { form: cleanName(facts.formName) };
  const comment = facts.comment?.trim() ? facts.comment : null;
  return renderEmail(
    {
      part: (language) => {
        const copy = template[language];
        const url = facts.link(language);
        return {
          subject: copy.subject(vars),
          section: languageSection(language, [
            paragraph(
              markup`${COPY[language].confirmationId} <strong>${facts.confirmationCode}</strong>`,
            ),
            paragraph(copy.sentence(vars)),
            url && paragraph(link(url, copy.linkText)),
          ]),
        };
      },
      subjectSuffix: `(${facts.confirmationCode})`,
      after: comment ? (order) => commentBlock(order, comment) : undefined,
    },
    languages,
  );
};
