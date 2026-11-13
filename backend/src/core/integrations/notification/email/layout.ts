import { markup, toHtmlString, type HtmlValue, type SafeHtml } from './html';
import type { EmailLanguage, EmailLanguages } from './language';
import type { SafeUrl } from '../../../appLinks';

/** One language's part of an email. */
export interface EmailPart {
  /** Plain text. */
  subject: string;
  /** The language's section, from `languageSection`. */
  section: SafeHtml;
}

/** What an email is made of. The layout adds the frame, the language order and the footer. */
export interface EmailParts {
  /** Called once for each language the email goes out in. */
  part: (language: EmailLanguage) => EmailPart;
  /** Added once after every language's subject. */
  subjectSuffix?: string;
  /** A block in no particular language, after the sections; given the languages in order. */
  after?: (order: readonly EmailLanguage[]) => HtmlValue;
}

export interface RenderedEmail {
  subject: string;
  body: string;
  bodyType: 'html';
}

const FOOTER: Readonly<Record<EmailLanguage, string>> = {
  en: 'This is an automated message from CHEFS. Please do not reply.',
  fr: 'Ce message automatique provient de CHEFS. Veuillez ne pas y répondre.',
};
const FRENCH_FOLLOWS = '(Le français suit)';

// Inline styles only: mail clients drop style sheets. Colours meet WCAG AA on white.
const CONTAINER_STYLE =
  'max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#2d2d2d;';
const PARAGRAPH_STYLE = 'margin:0 0 16px 0;';
const LINK_STYLE = 'color:#255a90;text-decoration:underline;';
const FOOTER_STYLE = 'margin:0;font-size:14px;line-height:20px;color:#474543;';

const DIVIDER = markup`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="border-top:1px solid #d8d8d8;height:16px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
const LINE_BREAK = markup`<br>`;

/** Block-level parts one per line, leaving out the ones that render nothing. */
const lines = (parts: readonly HtmlValue[]): HtmlValue[] =>
  parts
    .filter((part) => part !== null && part !== undefined && part !== false && part !== '')
    .flatMap((part, index) => (index === 0 ? [part] : ['\n', part]));

export const paragraph = (content: HtmlValue): SafeHtml =>
  markup`<p style="${PARAGRAPH_STYLE}">${content}</p>`;

export const link = (url: SafeUrl, text: string): SafeHtml =>
  markup`<a href="${url}" style="${LINK_STYLE}">${text}</a>`;

/** Text as typed, keeping its line breaks. */
export const withLineBreaks = (text: string): HtmlValue[] =>
  text.split(/\r\n|\r|\n/).flatMap((line, index) => (index === 0 ? [line] : [LINE_BREAK, line]));

/** A language's section: its blocks, marked with the language. */
export const languageSection = (language: EmailLanguage, blocks: readonly HtmlValue[]): SafeHtml =>
  markup`<div lang="${language}">
${lines(blocks)}
</div>`;

const footer = (order: readonly EmailLanguage[]): SafeHtml =>
  markup`<p style="${FOOTER_STYLE}">${order.map(
    (language, index) =>
      markup`${index > 0 && LINE_BREAK}<span lang="${language}">${FOOTER[language]}</span>`,
  )}</p>`;

/**
 * The email in one language or both, English first. The body is a fragment: the provider puts its
 * own header in front of it.
 */
export const renderEmail = (parts: EmailParts, languages: EmailLanguages): RenderedEmail => {
  const order: readonly EmailLanguage[] = languages === 'both' ? ['en', 'fr'] : [languages];
  const byLanguage = order.map((language) => parts.part(language));
  const subject = [byLanguage.map((part) => part.subject).join(' / '), parts.subjectSuffix]
    .filter(Boolean)
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  const body = markup`<div style="${CONTAINER_STYLE}">
${lines([
  order.length > 1 && paragraph(markup`<span lang="fr">${FRENCH_FOLLOWS}</span>`),
  ...byLanguage.flatMap((part, index) => [index > 0 && DIVIDER, part.section]),
  parts.after?.(order),
  footer(order),
])}
</div>`;
  return { subject, body: toHtmlString(body), bodyType: 'html' };
};
