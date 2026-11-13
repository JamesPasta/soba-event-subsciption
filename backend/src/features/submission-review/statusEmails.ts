import { SubmissionReviewStatuses, type SubmissionReviewStatus } from '@soba/lib';
import { env } from '../../core/config/env';
import {
  DEFAULT_EMAIL_LANGUAGE,
  type EmailLanguage,
} from '../../core/integrations/notification/email/language';
import type { RenderedEmail } from '../../core/integrations/notification/email/layout';
import {
  renderSubmissionEmail,
  type SubmissionEmailTemplate,
} from '../../core/integrations/notification/email/submissionEmail';
import {
  designerSubmissionUrl,
  formsSubmissionUrl,
  type FormsSubmissionPage,
  type SafeUrl,
} from '../../core/appLinks';
import { ASSIGNED_EMAIL, COMPLETED_EMAIL, REVISING_EMAIL } from './statusEmailTemplates';

/** Who a status email goes to: the assignee, or the people who submitted it. */
export const StatusEmailAudience = {
  assignee: 'assignee',
  submitters: 'submitters',
} as const;
type StatusEmailAudienceCode = (typeof StatusEmailAudience)[keyof typeof StatusEmailAudience];

/** What a status email names about its submission. */
export interface StatusEmailFacts {
  formId: string;
  formName: string;
  confirmationCode: string;
}

type StatusEmailLink = (
  facts: StatusEmailFacts,
  submissionId: string,
  language: EmailLanguage,
) => SafeUrl | null;

export interface StatusEmail {
  audience: StatusEmailAudienceCode;
  /** The app the link opens: the designer for staff, the forms app for submitters. */
  link: StatusEmailLink;
  template: SubmissionEmailTemplate;
}

const designerLink: StatusEmailLink = (facts, submissionId, language) =>
  designerSubmissionUrl(env.getDesignerAppUrl(), language, facts.formId, submissionId);

const formsLink =
  (page: FormsSubmissionPage): StatusEmailLink =>
  (_facts, submissionId, language) =>
    formsSubmissionUrl(env.getFormsAppUrl(), language, page, submissionId);

/** The email a status change sends. Submitted sends none: the submit has its own confirmation. */
const STATUS_EMAILS: Partial<Record<SubmissionReviewStatus, StatusEmail>> = {
  [SubmissionReviewStatuses.assigned]: {
    audience: StatusEmailAudience.assignee,
    link: designerLink,
    template: ASSIGNED_EMAIL,
  },
  [SubmissionReviewStatuses.revising]: {
    audience: StatusEmailAudience.submitters,
    link: formsLink('submit'),
    template: REVISING_EMAIL,
  },
  [SubmissionReviewStatuses.completed]: {
    audience: StatusEmailAudience.submitters,
    link: formsLink('submission'),
    template: COMPLETED_EMAIL,
  },
};

/** The email moving to `status` sends, or undefined when it sends none. */
export const statusEmailFor = (status: SubmissionReviewStatus): StatusEmail | undefined =>
  STATUS_EMAILS[status];

/** The status email for a submission in both languages, with the comment when it goes in. */
export const renderStatusEmail = (
  email: StatusEmail,
  facts: StatusEmailFacts,
  submissionId: string,
  comment: string | undefined,
): RenderedEmail =>
  renderSubmissionEmail(
    email.template,
    {
      formName: facts.formName,
      confirmationCode: facts.confirmationCode,
      link: (language) => email.link(facts, submissionId, language),
      comment,
    },
    DEFAULT_EMAIL_LANGUAGE,
  );

/**
 * Whether moving to `status` emails anyone. Assigning a submission to yourself does not: no one is
 * emailed about a change they made.
 */
export const sendsStatusEmail = (
  status: SubmissionReviewStatus,
  assigneeId: string | null,
  actorId: string,
): boolean => {
  const email = STATUS_EMAILS[status];
  if (!email) return false;
  return email.audience !== StatusEmailAudience.assignee || assigneeId !== actorId;
};
