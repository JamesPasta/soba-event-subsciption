import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  SubmissionReviewStatuses,
  type SubmissionReview,
  type SubmissionReviewUser,
} from '@/src/types/submissionReview';

vi.mock('@/app/[lang]/Providers', async () => {
  const dict = { ...(await import('@/dictionaries/en.json')).default, locale: 'en' };
  return { useDictionary: () => dict };
});

import { SubmissionStatusPanel } from '@/src/features/designer/ui/SubmissionStatusPanel';

const GRACE: SubmissionReviewUser = {
  id: 'u-grace',
  displayName: 'Grace Hopper',
  email: 'grace@example.com',
};
const ADA: SubmissionReviewUser = { id: 'u-ada', displayName: 'Ada Lovelace', email: null };

const ASSIGNED = {
  id: 's2',
  status: SubmissionReviewStatuses.assigned,
  assignee: GRACE,
  changedAt: '2026-01-03T03:04:05Z',
  updatedBy: 'Ada Lovelace',
};
const SUBMITTED = {
  id: 's1',
  status: SubmissionReviewStatuses.submitted,
  assignee: null,
  changedAt: '2026-01-02T03:04:05Z',
  updatedBy: 'Ada Lovelace',
};
const REVIEW: SubmissionReview = {
  allowStatusUpdates: true,
  statusHistory: [ASSIGNED, SUBMITTED],
  notes: [],
  editHistory: [],
};
const ONLY_SUBMITTED: SubmissionReview = { ...REVIEW, statusHistory: [SUBMITTED] };
const REVISING_REVIEW: SubmissionReview = {
  ...REVIEW,
  statusHistory: [
    { ...SUBMITTED, id: 's3', status: SubmissionReviewStatuses.revising },
    ASSIGNED,
    SUBMITTED,
  ],
};

/** Opens a design-system Select by its label and picks an option. */
async function choose(user: ReturnType<typeof userEvent.setup>, testId: string, option: string) {
  await user.click(within(screen.getByTestId(testId)).getByRole('button'));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('SubmissionStatusPanel', () => {
  it('shows the latest status change as the current status and assignee', () => {
    render(<SubmissionStatusPanel review={REVIEW} />);

    expect(screen.getByTestId('submission-status-current')).toHaveTextContent(
      'Current Status: Assigned',
    );
    expect(screen.getByTestId('submission-status-assignee')).toHaveTextContent(
      'Assigned To: Grace Hopper (grace@example.com)',
    );
  });

  it('says Unassigned when the current status has no assignee', () => {
    render(<SubmissionStatusPanel review={ONLY_SUBMITTED} />);

    expect(screen.getByTestId('submission-status-current')).toHaveTextContent('Submitted');
    expect(screen.getByTestId('submission-status-assignee')).toHaveTextContent(
      'Assigned To: Unassigned',
    );
  });

  it('offers no way to change the status to a caller who may not', () => {
    render(<SubmissionStatusPanel review={REVIEW} />);

    expect(screen.queryByTestId('submission-status-select')).toBeNull();
    expect(screen.queryByTestId('submission-status-update')).toBeNull();
    expect(screen.getByTestId('submission-status-history')).toBeInTheDocument();
  });

  it("tells a reviewer when the form's settings turn status changes off", () => {
    render(<SubmissionStatusPanel review={REVIEW} updatesOff />);

    expect(screen.getByTestId('submission-status-updates-off')).toHaveTextContent(
      "Status changes are turned off in this form's review settings.",
    );
  });

  it('offers only the moves allowed from the current status', async () => {
    const user = userEvent.setup();
    render(<SubmissionStatusPanel review={ONLY_SUBMITTED} canUpdate reviewers={[GRACE]} />);

    await user.click(within(screen.getByTestId('submission-status-select')).getByRole('button'));

    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toEqual(['Assigned', 'Completed', 'Revising']);
  });

  it('sends the submission back to revise, saying what that does', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<SubmissionStatusPanel review={REVIEW} canUpdate onUpdate={onUpdate} />);

    await choose(user, 'submission-status-select', 'Revising');
    expect(screen.getByTestId('submission-status-move-hint')).toHaveTextContent(
      'The submitters can change their answers and files, then submit again.',
    );
    expect(screen.queryByTestId('submission-status-assignee-select')).toBeNull();
    await user.click(screen.getByTestId('submission-status-update'));

    expect(onUpdate).toHaveBeenCalledWith({
      status: SubmissionReviewStatuses.revising,
      assigneeId: null,
    });
  });

  it('saves a comment with the change, and attaches it to the email when asked', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<SubmissionStatusPanel review={REVIEW} canUpdate onUpdate={onUpdate} />);

    const attach = within(screen.getByTestId('submission-status-attach-comment')).getByRole(
      'checkbox',
    );
    expect(attach).toBeDisabled();
    await choose(user, 'submission-status-select', 'Revising');
    await user.type(
      within(screen.getByTestId('submission-status-comment')).getByRole('textbox'),
      '  Please attach the declaration.  ',
    );
    await user.click(attach);
    await user.click(screen.getByTestId('submission-status-update'));

    expect(onUpdate).toHaveBeenCalledWith({
      status: SubmissionReviewStatuses.revising,
      assigneeId: null,
      comment: 'Please attach the declaration.',
      attachCommentToEmail: true,
    });
    // Typing a sentence is slow under a full-suite run.
  }, 15_000);

  it('warns that ending a revision restores the answers from before it', async () => {
    const user = userEvent.setup();
    render(<SubmissionStatusPanel review={REVISING_REVIEW} canUpdate />);

    expect(screen.queryByTestId('submission-status-move-hint')).toBeNull();
    await choose(user, 'submission-status-select', 'Completed');

    expect(screen.getByTestId('submission-status-move-hint')).toHaveTextContent(
      'Ending the revision restores the answers from before it.',
    );
  });

  // Someone else's change can remove the move the reviewer had picked.
  it('drops a chosen status the current one no longer moves to', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SubmissionStatusPanel review={ONLY_SUBMITTED} canUpdate />);
    await choose(user, 'submission-status-select', 'Revising');
    expect(screen.getByTestId('submission-status-update')).toBeEnabled();

    rerender(<SubmissionStatusPanel review={REVISING_REVIEW} canUpdate />);

    expect(screen.getByTestId('submission-status-update')).toBeDisabled();
    expect(screen.queryByTestId('submission-status-move-hint')).toBeNull();
  });

  it('assigns the submission to the reviewer picked', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(
      <SubmissionStatusPanel
        review={ONLY_SUBMITTED}
        canUpdate
        reviewers={[ADA, GRACE]}
        onUpdate={onUpdate}
      />,
    );

    await choose(user, 'submission-status-select', 'Assigned');
    expect(screen.getByTestId('submission-status-update')).toBeDisabled();
    await choose(user, 'submission-status-assignee-select', 'Grace Hopper (grace@example.com)');
    await user.click(screen.getByTestId('submission-status-update'));

    expect(onUpdate).toHaveBeenCalledWith({
      status: SubmissionReviewStatuses.assigned,
      assigneeId: GRACE.id,
    });
  });

  it('assigns the submission to the signed-in reviewer with Assign to Me', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(
      <SubmissionStatusPanel
        review={ONLY_SUBMITTED}
        canUpdate
        reviewers={[ADA, GRACE]}
        currentUserId={ADA.id}
        onUpdate={onUpdate}
      />,
    );

    await choose(user, 'submission-status-select', 'Assigned');
    await user.click(screen.getByTestId('submission-status-assign-me'));
    await user.click(screen.getByTestId('submission-status-update'));

    expect(onUpdate).toHaveBeenCalledWith({
      status: SubmissionReviewStatuses.assigned,
      assigneeId: ADA.id,
    });
  });

  it('does not offer Assign to Me to someone who is not a reviewer', async () => {
    const user = userEvent.setup();
    render(
      <SubmissionStatusPanel
        review={ONLY_SUBMITTED}
        canUpdate
        reviewers={[GRACE]}
        currentUserId={ADA.id}
      />,
    );

    await choose(user, 'submission-status-select', 'Assigned');

    expect(screen.queryByTestId('submission-status-assign-me')).toBeNull();
  });

  it('completes the submission without an assignee', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<SubmissionStatusPanel review={REVIEW} canUpdate onUpdate={onUpdate} />);

    await choose(user, 'submission-status-select', 'Completed');
    expect(screen.queryByTestId('submission-status-assignee-select')).toBeNull();
    await user.click(screen.getByTestId('submission-status-update'));

    expect(onUpdate).toHaveBeenCalledWith({
      status: SubmissionReviewStatuses.completed,
      assigneeId: null,
    });
  });

  it('keeps the choice when the change is not saved', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(false);
    render(<SubmissionStatusPanel review={REVIEW} canUpdate onUpdate={onUpdate} />);

    await choose(user, 'submission-status-select', 'Completed');
    await user.click(screen.getByTestId('submission-status-update'));

    expect(screen.getByTestId('submission-status-update')).toBeEnabled();
  });

  it('lists every status change, newest first, in the history', async () => {
    const user = userEvent.setup();
    render(<SubmissionStatusPanel review={REVIEW} />);

    await user.click(screen.getByTestId('submission-status-history'));

    // A status tag carries rows of its own, so the order is read from the text.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('StatusDate Status ChangedAssigneeUpdated By');
    expect(dialog).toHaveTextContent(/Assigned.*Grace Hopper.*Ada Lovelace.*Submitted/);
  });

  it('says there is no status yet for a submission never submitted', () => {
    render(<SubmissionStatusPanel review={{ ...REVIEW, statusHistory: [] }} canUpdate />);

    expect(screen.getByTestId('submission-status-none')).toHaveTextContent('No review status yet.');
    expect(screen.queryByTestId('submission-status-history')).toBeNull();
    expect(screen.queryByTestId('submission-status-select')).toBeNull();
  });
});
