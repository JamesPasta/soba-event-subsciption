import { DEFAULT_EMAIL_LANGUAGE } from '../../core/integrations/notification/email/language';
import type { RenderedEmail } from '../../core/integrations/notification/email/layout';
import {
  defineSubmissionEmail,
  renderSubmissionEmail,
} from '../../core/integrations/notification/email/submissionEmail';
import { designerSubmissionUrl } from '../../core/integrations/notification/email/url';
import type { PostSubmissionActionSubmission } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';

export const NOTICE = defineSubmissionEmail({
  en: {
    subject: ({ form }) => `${form} Submission`,
    sentence: ({ form }) => `There is a new ${form} submission. Please sign in to review it.`,
    linkText: 'View this submission',
  },
  fr: {
    subject: ({ form }) => `Soumission : ${form}`,
    sentence: ({ form }) =>
      `Il y a une nouvelle soumission pour ${form}. Veuillez vous connecter pour l’examiner.`,
    linkText: 'Voir cette soumission',
  },
});

/**
 * The notice for a submission. Each language links to the submission in the designer, which needs
 * sign-in and access to it; there is no link when the designer URL is not set.
 */
export const buildNotice = (
  submission: PostSubmissionActionSubmission,
  designerAppUrl: string | undefined,
): RenderedEmail =>
  renderSubmissionEmail(
    NOTICE,
    {
      formName: submission.formName,
      confirmationCode: submission.confirmationCode,
      link: (language) =>
        designerSubmissionUrl(designerAppUrl, language, submission.formId, submission.id),
    },
    DEFAULT_EMAIL_LANGUAGE,
  );
