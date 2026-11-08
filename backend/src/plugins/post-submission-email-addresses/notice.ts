import {
  cleanName,
  designerSubmissionLink,
  escapeHtml,
} from '../../core/integrations/notification/emailText';
import type { PostSubmissionActionSubmission } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';

/** The submission in the designer; opening it needs sign-in and access to the submission. */
export const designerLink = (
  designerAppUrl: string | undefined,
  submission: PostSubmissionActionSubmission,
): string | null => designerSubmissionLink(designerAppUrl, submission.formId, submission.id);

export interface Notice {
  subject: string;
  body: string;
  bodyType: 'html';
}

/** The fixed notice: the confirmation ID, the form and the link. The subject is plain text. */
export const buildNotice = (
  submission: PostSubmissionActionSubmission,
  link: string | null,
): Notice => {
  const formName = cleanName(submission.formName);
  const paragraphs = [
    `Confirmation ID: <strong>${escapeHtml(submission.confirmationCode)}</strong>`,
    `There is a new ${escapeHtml(formName)} submission. Please sign in to review it.`,
    ...(link ? [`<a href="${escapeHtml(link)}">View this submission</a>`] : []),
  ];
  return {
    subject: `${formName} Submission`,
    body: paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n'),
    bodyType: 'html',
  };
};
