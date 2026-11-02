import { cleanName, designerSubmissionLink } from '../../core/integrations/notification/emailText';
import type { PostSubmissionActionSubmission } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';

/** The submission in the designer; opening it needs sign-in and access to the submission. */
export const designerLink = (
  designerAppUrl: string | undefined,
  submission: PostSubmissionActionSubmission,
): string | null => designerSubmissionLink(designerAppUrl, submission.formId, submission.id);

export interface Notice {
  subject: string;
  body: string;
}

/** The fixed notice: the form, the confirmation ID, the link and who set it up. */
export const buildNotice = (
  submission: PostSubmissionActionSubmission,
  link: string | null,
): Notice => {
  const formName = cleanName(submission.formName);
  const workspaceName = cleanName(submission.workspaceName);
  const lines = [
    `A submission to "${formName}" was received.`,
    '',
    `Confirmation ID: ${submission.confirmationCode}`,
    ...(link ? ['', `View it (sign-in required): ${link}`] : []),
    '',
    `You are receiving this because the team for this form in the "${workspaceName}" workspace set up this notice.`,
  ];
  return { subject: `Submission received: ${formName}`, body: lines.join('\n') };
};
