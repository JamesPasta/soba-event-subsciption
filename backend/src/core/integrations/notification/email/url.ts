import { withoutTrailingSlashes } from '../emailText';
import type { EmailLanguage } from './language';

declare const safeUrl: unique symbol;

/** An absolute link into one of the apps, made only by the helpers here. */
export type SafeUrl = string & { readonly [safeUrl]: true };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Why `base` cannot start an email link, or null when it can. */
export const appUrlProblem = (base: string): string | null => {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return 'is not a URL';
  }
  if (url.username || url.password) return 'must not carry credentials';
  if (url.search || url.hash) return 'must not have a query or fragment';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return null;
  return 'must use https, or http on localhost';
};

/** Stops startup when an app URL that email links start from is set but unusable. */
export const assertEmailLinkBases = (bases: Readonly<Record<string, string | undefined>>): void => {
  for (const [name, base] of Object.entries(bases)) {
    const problem = base ? appUrlProblem(base) : null;
    if (problem) throw new Error(`${name} ${problem}`);
  }
};

const appLink = (base: string | undefined, segments: readonly string[]): SafeUrl | null => {
  if (!base) return null;
  const problem = appUrlProblem(base);
  if (problem) throw new Error(`An email link base ${problem}`);
  return `${withoutTrailingSlashes(base)}/${segments.map(encodeURIComponent).join('/')}` as SafeUrl;
};

/** The submission in the designer; opening it needs sign-in and access to the submission. */
export const designerSubmissionUrl = (
  base: string | undefined,
  language: EmailLanguage,
  formId: string,
  submissionId: string,
): SafeUrl | null => appLink(base, [language, 'build', formId, 'submissions', submissionId]);

/** A forms-app page for the submission: `submit` to change it, `submission` to read it. */
export type FormsSubmissionPage = 'submit' | 'submission';

/** The submission in the forms app; opening it needs sign-in as one of its submitters. */
export const formsSubmissionUrl = (
  base: string | undefined,
  language: EmailLanguage,
  page: FormsSubmissionPage,
  submissionId: string,
): SafeUrl | null => appLink(base, [language, page, submissionId]);
