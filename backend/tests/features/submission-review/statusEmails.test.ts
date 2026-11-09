jest.mock('../../../src/core/config/env', () => ({
  env: {
    getDesignerAppUrl: () => 'https://design.example/',
    getFormsAppUrl: () => 'https://forms.example/',
  },
}));

import { SubmissionReviewStatuses } from '@soba/lib';
import {
  renderStatusEmail,
  sendsStatusEmail,
  statusEmailFor,
  type StatusEmail,
} from '../../../src/features/submission-review/statusEmails';

const FACTS = {
  formId: 'f1',
  formName: 'Permit application',
  confirmationCode: 'K7M2Q9XA',
  submitterEmails: ['sub@example.com'],
};

const emailFor = (status: Parameters<typeof statusEmailFor>[0]): StatusEmail => {
  const email = statusEmailFor(status);
  if (!email) throw new Error(`No email for ${status}`);
  return email;
};

it('emails the assignee on Assigned, and the submitters on Revising and Completed', () => {
  expect(emailFor(SubmissionReviewStatuses.assigned).audience).toBe('assignee');
  expect(emailFor(SubmissionReviewStatuses.revising).audience).toBe('submitters');
  expect(emailFor(SubmissionReviewStatuses.completed).audience).toBe('submitters');
});

it('sends nothing for Submitted, which has its own confirmation, or for assigning yourself', () => {
  expect(statusEmailFor(SubmissionReviewStatuses.submitted)).toBeUndefined();
  expect(sendsStatusEmail(SubmissionReviewStatuses.submitted, null, 'rev-1')).toBe(false);
  expect(sendsStatusEmail(SubmissionReviewStatuses.assigned, 'rev-1', 'rev-1')).toBe(false);
  expect(sendsStatusEmail(SubmissionReviewStatuses.assigned, 'u-grace', 'rev-1')).toBe(true);
  expect(sendsStatusEmail(SubmissionReviewStatuses.completed, null, 'rev-1')).toBe(true);
});

it('links the assignee to the designer in each language', () => {
  const { subject, body } = renderStatusEmail(
    emailFor(SubmissionReviewStatuses.assigned),
    FACTS,
    's1',
    undefined,
  );
  expect(subject).toBe(
    'Permit application Submission Assignment / Attribution de soumission : Permit application (K7M2Q9XA)',
  );
  expect(body).toContain('href="https://design.example/en/build/f1/submissions/s1"');
  expect(body).toContain('href="https://design.example/fr/build/f1/submissions/s1"');
});

it('links submitters to the forms app: the submit page to revise, the submission when complete', () => {
  const revising = renderStatusEmail(
    emailFor(SubmissionReviewStatuses.revising),
    FACTS,
    's1',
    'Please attach the signed declaration.',
  );
  expect(revising.body).toContain('href="https://forms.example/fr/submit/s1"');
  expect(revising.body).toContain(
    '<strong>Comments: / Commentaires :</strong><br>Please attach the signed declaration.',
  );

  const completed = renderStatusEmail(
    emailFor(SubmissionReviewStatuses.completed),
    FACTS,
    's1',
    undefined,
  );
  expect(completed.body).toContain('href="https://forms.example/en/submission/s1"');
  expect(completed.body).not.toContain('Comments');
});

it('keeps a form name to one plain line, with no links and any $ as typed', () => {
  const { subject, body } = renderStatusEmail(
    emailFor(SubmissionReviewStatuses.completed),
    { ...FACTS, formName: 'Grant $$ \n https://evil.example form' },
    's1',
    undefined,
  );
  expect(subject.startsWith('Grant $$ [link removed] form Submission Completed')).toBe(true);
  expect(body).toContain('The review of your Grant $$ [link removed] form submission is complete.');
  expect(body).not.toContain('evil.example');
});
