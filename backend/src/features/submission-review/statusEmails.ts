import { SubmissionReviewStatuses, type SubmissionReviewStatus } from '@soba/lib';
import { env } from '../../core/config/env';
import {
  findStatusEmailFacts,
  findUserEmail,
  type StatusEmailFacts,
} from '../../core/db/repos/submissionReviewRepo';
import {
  cleanName,
  designerSubmissionLink,
  withoutTrailingSlashes,
} from '../../core/integrations/notification/emailText';
import { log } from '../../core/logging';
import { notificationService } from '../notifications/service';

/** Who a status email goes to: the assignee, or the people who submitted it. */
const StatusEmailAudience = {
  assignee: 'assignee',
  submitters: 'submitters',
} as const;
type StatusEmailAudienceCode = (typeof StatusEmailAudience)[keyof typeof StatusEmailAudience];

interface StatusEmailTemplate {
  audience: StatusEmailAudienceCode;
  /** The app the link opens and its path from the locale on. */
  link: (facts: StatusEmailFacts, submissionId: string) => string | null;
  en: { subject: string; body: string };
  fr: { subject: string; body: string };
}

const designerLink = (facts: StatusEmailFacts, submissionId: string) =>
  designerSubmissionLink(env.getDesignerAppUrl(), facts.formId, submissionId);

const formsLink = (path: string) => (_facts: StatusEmailFacts, submissionId: string) => {
  const base = env.getFormsAppUrl();
  return base ? `${withoutTrailingSlashes(base)}/en/${path}/${submissionId}` : null;
};

/**
 * The emails a status change sends, in English then French. `{code}` and `{form}` name the
 * submission. Submitted sends none: the submit has its own confirmation.
 */
const STATUS_EMAILS: Partial<Record<SubmissionReviewStatus, StatusEmailTemplate>> = {
  [SubmissionReviewStatuses.assigned]: {
    audience: StatusEmailAudience.assignee,
    link: designerLink,
    en: {
      subject: 'Submission {code} is assigned to you',
      body: 'Submission {code} of {form} is assigned to you for review.',
    },
    fr: {
      subject: 'La soumission {code} vous est attribuée',
      body: 'La soumission {code} de {form} vous est attribuée pour examen.',
    },
  },
  [SubmissionReviewStatuses.revising]: {
    audience: StatusEmailAudience.submitters,
    link: formsLink('submit'),
    en: {
      subject: 'Please revise your submission {code}',
      body: 'A reviewer asked you to revise your submission {code} of {form}. Open it, make your changes and submit it again.',
    },
    fr: {
      subject: 'Veuillez réviser votre soumission {code}',
      body: 'Un examinateur vous demande de réviser votre soumission {code} de {form}. Ouvrez-la, apportez vos modifications et soumettez-la de nouveau.',
    },
  },
  [SubmissionReviewStatuses.completed]: {
    audience: StatusEmailAudience.submitters,
    link: formsLink('submission'),
    en: {
      subject: 'The review of your submission {code} is complete',
      body: 'The review of your submission {code} of {form} is complete.',
    },
    fr: {
      subject: 'L’examen de votre soumission {code} est terminé',
      body: 'L’examen de votre soumission {code} de {form} est terminé.',
    },
  },
};

const COMMENT_HEADING = { en: 'Comment from the reviewer:', fr: 'Commentaire de l’examinateur :' };
const LINK_HEADING = { en: 'Open it here:', fr: 'Ouvrez-la ici :' };

// Replacer functions, so a `$` in a form name stays as typed.
const fill = (text: string, facts: StatusEmailFacts) =>
  text
    .replaceAll('{code}', () => facts.confirmationCode)
    .replaceAll('{form}', () => cleanName(facts.formName));

/** The email text, English then French, with the reviewer's comment and the link when there are. */
export const statusEmailContent = (
  template: StatusEmailTemplate,
  facts: StatusEmailFacts,
  link: string | null,
  comment: string | undefined,
): { subject: string; body: string } => {
  const part = (lang: 'en' | 'fr') =>
    [
      fill(template[lang].body, facts),
      comment ? `${COMMENT_HEADING[lang]}\n${comment}` : null,
      link ? `${LINK_HEADING[lang]} ${link}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');
  return {
    subject: `${fill(template.en.subject, facts)} / ${fill(template.fr.subject, facts)}`,
    body: `${part('en')}\n\n---\n\n${part('fr')}`,
  };
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

/**
 * Sends the email a committed status change calls for, through the notification service, which
 * audits the send and never throws. Nothing here undoes the change: a lookup that fails is logged,
 * and a status with no email, or no one to send it to, sends nothing.
 */
export const sendStatusEmail = async (input: StatusEmailInput): Promise<void> => {
  const template = STATUS_EMAILS[input.status];
  if (!template) return;
  try {
    const facts = await findStatusEmailFacts(input.workspaceId, input.submissionId);
    if (!facts) return;
    const to =
      template.audience === StatusEmailAudience.assignee
        ? [input.assigneeId ? await findUserEmail(input.assigneeId) : null].filter(
            (email): email is string => !!email,
          )
        : facts.submitterEmails;
    if (to.length === 0) return;
    const content = statusEmailContent(
      template,
      facts,
      template.link(facts, input.submissionId),
      input.comment,
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
          { recipients: { to: [address] }, content: { ...content, bodyType: 'text' } },
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
