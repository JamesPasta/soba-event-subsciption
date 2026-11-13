import type { AppLanguage } from '../../../appLinks';

/** A language an email can be written in. */
export type EmailLanguage = AppLanguage;

/** How an email goes out: in one language, or in both with English first. */
export type EmailLanguages = EmailLanguage | 'both';

/** SOBA does not know recipients' languages, so emails go out in both. */
export const DEFAULT_EMAIL_LANGUAGE: EmailLanguages = 'both';
