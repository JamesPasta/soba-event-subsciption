const mockFacts = jest.fn();
const mockUserEmail = jest.fn();
jest.mock('../../../src/core/db/repos/submissionReviewRepo', () => ({
  findStatusEmailFacts: (...args: unknown[]) => mockFacts(...args),
  findUserEmail: (...args: unknown[]) => mockUserEmail(...args),
}));
const mockSend = jest.fn();
jest.mock('../../../src/features/notifications/service', () => ({
  notificationService: { sendEmail: (...args: unknown[]) => mockSend(...args) },
}));
jest.mock('../../../src/core/config/env', () => ({
  env: {
    getDesignerAppUrl: () => 'https://design.example/',
    getFormsAppUrl: () => 'https://forms.example/',
  },
}));

import { SubmissionReviewStatuses } from '@soba/lib';
import { sendStatusEmail } from '../../../src/features/submission-review/statusEmails';

const FACTS = {
  formId: 'f1',
  formName: 'Permit application',
  confirmationCode: 'K7M2Q9XA',
  submitterEmails: ['sub@example.com', 'collab@example.com'],
};
const BASE = { workspaceId: 'ws1', submissionId: 's1', actorId: 'rev-1', assigneeId: null };

const sent = () => {
  expect(mockSend).toHaveBeenCalledTimes(1);
  const [context, email] = mockSend.mock.calls[0];
  return { context, email };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFacts.mockResolvedValue(FACTS);
  mockUserEmail.mockResolvedValue('grace@example.com');
  mockSend.mockResolvedValue({ outcome: 'accepted', audited: true });
});

it('tells the assignee, with a link to the staff page', async () => {
  await sendStatusEmail({
    ...BASE,
    status: SubmissionReviewStatuses.assigned,
    assigneeId: 'u-grace',
  });

  const { context, email } = sent();
  expect(mockUserEmail).toHaveBeenCalledWith('u-grace');
  expect(email.recipients).toEqual({ to: ['grace@example.com'] });
  expect(email.content.subject).toBe(
    'Submission K7M2Q9XA is assigned to you / La soumission K7M2Q9XA vous est attribuée',
  );
  expect(email.content.body).toContain('https://design.example/en/build/f1/submissions/s1');
  expect(context).toEqual({
    workspaceId: 'ws1',
    formId: 'f1',
    submissionId: 's1',
    actorId: 'rev-1',
  });
});

it('asks the submitters to revise, in English and French, with the comment attached', async () => {
  await sendStatusEmail({
    ...BASE,
    status: SubmissionReviewStatuses.revising,
    comment: 'Please attach the signed declaration.',
  });

  expect(mockSend.mock.calls.map(([, email]) => email.recipients.to)).toEqual([
    ['sub@example.com'],
    ['collab@example.com'],
  ]);
  const [, email] = mockSend.mock.calls[0];
  expect(email.content.body).toMatch(
    /revise your submission K7M2Q9XA of Permit application[\s\S]*Comment from the reviewer:\nPlease attach the signed declaration\.[\s\S]*https:\/\/forms\.example\/en\/submit\/s1[\s\S]*---[\s\S]*Commentaire de l’examinateur/,
  );
});

it('keeps a form name to one plain line, with no links and any $ as typed', async () => {
  mockFacts.mockResolvedValue({
    ...FACTS,
    formName: 'Grant $$ \n https://evil.example form',
    submitterEmails: ['sub@example.com'],
  });

  await sendStatusEmail({ ...BASE, status: SubmissionReviewStatuses.completed });

  const { email } = sent();
  expect(email.content.body).toContain('K7M2Q9XA of Grant $$ [link removed] form is complete.');
  expect(email.content.body).not.toContain('evil.example');
});

it('tells the submitters the review is complete, without a comment unless attached', async () => {
  mockFacts.mockResolvedValue({ ...FACTS, submitterEmails: ['sub@example.com'] });

  await sendStatusEmail({ ...BASE, status: SubmissionReviewStatuses.completed });

  const { email } = sent();
  expect(email.content.body).toContain('The review of your submission K7M2Q9XA');
  expect(email.content.body).toContain('https://forms.example/en/submission/s1');
  expect(email.content.body).not.toContain('Comment from the reviewer');
});

it('sends nothing for Submitted, which has its own confirmation', async () => {
  await sendStatusEmail({ ...BASE, status: SubmissionReviewStatuses.submitted });

  expect(mockFacts).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

it('sends nothing when no one has an email', async () => {
  mockFacts.mockResolvedValue({ ...FACTS, submitterEmails: [] });
  mockUserEmail.mockResolvedValue(null);

  await sendStatusEmail({ ...BASE, status: SubmissionReviewStatuses.completed });
  await sendStatusEmail({ ...BASE, status: SubmissionReviewStatuses.assigned, assigneeId: 'u1' });

  expect(mockSend).not.toHaveBeenCalled();
});

// The status change is already committed; a failed lookup must not reach the response.
it('never throws when a lookup fails', async () => {
  mockFacts.mockRejectedValue(new Error('db down'));

  await expect(
    sendStatusEmail({ ...BASE, status: SubmissionReviewStatuses.completed }),
  ).resolves.toBeUndefined();
  expect(mockSend).not.toHaveBeenCalled();
});
