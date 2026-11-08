import { SubmissionReviewStatuses, type SubmissionReviewStatus } from '@soba/lib';
import { env } from '../../core/config/env';
import {
  findStatusEmailFacts,
  findUserEmail,
  type StatusEmailFacts,
} from '../../core/db/repos/submissionReviewRepo';
import {
  DEFAULT_EMAIL_LANGUAGE,
  type EmailLanguage,
} from '../../core/integrations/notification/email/language';
import {
  renderSubmissionEmail,
  type SubmissionEmailTemplate,
} from '../../core/integrations/notification/email/submissionEmail';
import {
  designerSubmissionUrl,
  formsSubmissionUrl,
  type FormsSubmissionPage,
  type SafeUrl,
} from '../../core/integrations/notification/email/url';
import { log } from '../../core/logging';
import { notificationService } from '../notifications/service';
import { ASSIGNED_EMAIL, COMPLETED_EMAIL, REVISING_EMAIL } from './statusEmailTemplates';

/** Who a status email goes to: the assignee, or the people who submitted it. */
const StatusEmailAudience = {
  assignee: 'assignee',
  submitters: 'submitters',
} as const;
type StatusEmailAudienceCode = (typeof StatusEmailAudience)[keyof typeof StatusEmailAudience];

type StatusEmailLink = (
  facts: StatusEmailFacts,
  submissionId: string,
  language: EmailLanguage,
) => SafeUrl | null;

interface StatusEmail {
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

export interface StatusEmailInput {
  workspaceId: string;
  submissionId: string;
  actorId: string;
  status: SubmissionReviewStatus;
  assigneeId: string | null;
  /** The reviewer's comment, when they attached it to the email. */
  comment?: string;
}

const recipients = async (
  email: StatusEmail,
  facts: StatusEmailFacts,
  assigneeId: string | null,
): Promise<string[]> => {
  if (email.audience === StatusEmailAudience.submitters) return facts.submitterEmails;
  const address = assigneeId ? await findUserEmail(assigneeId) : null;
  return address ? [address] : [];
};

/**
 * Sends the email a committed status change calls for, through the notification service, which
 * audits the send and never throws. Nothing here undoes the change: a lookup that fails is logged,
 * and a status with no email, or no one to send it to, sends nothing. The person who made the
 * change is never emailed about it.
 */
export const sendStatusEmail = async (input: StatusEmailInput): Promise<void> => {
  const email = STATUS_EMAILS[input.status];
  if (!email) return;
  if (email.audience === StatusEmailAudience.assignee && input.assigneeId === input.actorId) return;
  try {
    const facts = await findStatusEmailFacts(input.workspaceId, input.submissionId, input.actorId);
    if (!facts) return;
    const to = await recipients(email, facts, input.assigneeId);
    if (to.length === 0) return;
    const content = renderSubmissionEmail(
      email.template,
      {
        formName: facts.formName,
        confirmationCode: facts.confirmationCode,
        link: (language) => email.link(facts, input.submissionId, language),
        comment: input.comment,
      },
      DEFAULT_EMAIL_LANGUAGE,
    );
    // One email per address, so submitters do not see each other's addresses.
    await Promise.all(
      to.map((address) =>
        notificationService.sendEmail(
          {
            workspaceId: input.workspaceId,
            formId: facts.formId,
            submissionId: input.submissionId,
            actorId: input.actorId,
          },
          { recipients: { to: [address] }, content },
        ),
      ),
    );
  } catch (err) {
    log.error(
      {
        workspaceId: input.workspaceId,
        submissionId: input.submissionId,
        status: input.status,
        errorName: err instanceof Error ? err.name : 'Error',
      },
      'Status email not sent',
    );
  }
};
