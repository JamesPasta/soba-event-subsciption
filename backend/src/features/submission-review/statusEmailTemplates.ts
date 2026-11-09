import { defineSubmissionEmail } from '../../core/integrations/notification/email/submissionEmail';

const LINK_TEXT = { en: 'View this submission', fr: 'Voir cette soumission' } as const;

/** To the reviewer a submission is assigned to; links to it in the designer. */
export const ASSIGNED_EMAIL = defineSubmissionEmail({
  en: {
    subject: ({ form }) => `${form} Submission Assignment`,
    sentence: ({ form }) =>
      `You have been assigned to a ${form} submission. Please sign in to review it.`,
    linkText: LINK_TEXT.en,
  },
  fr: {
    subject: ({ form }) => `Attribution de soumission : ${form}`,
    sentence: ({ form }) =>
      `Une soumission pour ${form} vous a été attribuée. Veuillez vous connecter pour l’examiner.`,
    linkText: LINK_TEXT.fr,
  },
});

/** To the submitters when a reviewer sends the submission back; links to it in the forms app. */
export const REVISING_EMAIL = defineSubmissionEmail({
  en: {
    subject: ({ form }) => `${form} Submission Revision Requested`,
    sentence: ({ form }) =>
      `You have been asked to revise your ${form} submission. Please sign in to make your changes and submit it again.`,
    linkText: LINK_TEXT.en,
  },
  fr: {
    subject: ({ form }) => `Révision demandée : ${form}`,
    sentence: ({ form }) =>
      `On vous demande de réviser votre soumission pour ${form}. Veuillez vous connecter pour apporter vos modifications et la soumettre de nouveau.`,
    linkText: LINK_TEXT.fr,
  },
});

/** To the submitters when the review is complete; links to it in the forms app. */
export const COMPLETED_EMAIL = defineSubmissionEmail({
  en: {
    subject: ({ form }) => `${form} Submission Completed`,
    sentence: ({ form }) => `The review of your ${form} submission is complete.`,
    linkText: LINK_TEXT.en,
  },
  fr: {
    subject: ({ form }) => `Examen terminé : ${form}`,
    sentence: ({ form }) => `L’examen de votre soumission pour ${form} est terminé.`,
    linkText: LINK_TEXT.fr,
  },
});
