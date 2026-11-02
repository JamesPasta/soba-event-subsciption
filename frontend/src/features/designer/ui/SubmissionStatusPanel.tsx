'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Form,
  Link,
  Select,
  TextArea,
} from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import type { Column } from '@/src/components/DataTable';
import { SecondaryText } from '@/src/components/SecondaryText';
import { StatusTag, workflowStateToVariant } from '@/src/components/StatusTag';
import { useFormatLongDate } from '@/src/shared/hooks/useFormatLongDate';
import type { StatusChange } from '@/src/features/designer/data/useSubmissionReview';
import {
  nextSubmissionStatuses,
  SUBMISSION_NOTE_MAX_LENGTH,
  SubmissionReviewStatuses,
  type SubmissionReview,
  type SubmissionReviewStatus,
  type SubmissionReviewUser,
  type SubmissionStatusChange,
} from '@/src/types/submissionReview';
import { SubmissionHistoryModal } from './SubmissionHistoryModal';

type SubmissionStatusPanelProps = {
  review: SubmissionReview;
  /** Whether the caller may change the status; without it the panel only reads. */
  canUpdate?: boolean;
  /** Says the form's review settings turn status changes off, for a reviewer who would otherwise. */
  updatesOff?: boolean;
  /** Who the submission can be assigned to. */
  reviewers?: readonly SubmissionReviewUser[];
  /** The signed-in user, offered as "Assign to Me" when they are a reviewer. */
  currentUserId?: string | null;
  /** Resolves true once the change is saved; the controls keep their values otherwise. */
  onUpdate?: (change: StatusChange) => Promise<boolean>;
};

/** A reviewer as the panel names them: their name, and their email when known. */
export const reviewerLabel = (user: SubmissionReviewUser): string =>
  user.email ? `${user.displayName} (${user.email})` : user.displayName;

/** What the chosen move does beyond the status, when it opens or ends a revision. */
const moveHintOf = (
  from: SubmissionReviewStatus | undefined,
  to: SubmissionReviewStatus | null,
): 'revisingHint' | 'endRevisionHint' | null => {
  if (to === SubmissionReviewStatuses.revising) return 'revisingHint';
  if (to && from === SubmissionReviewStatuses.revising) return 'endRevisionHint';
  return null;
};

/** The chosen move, unless someone else's change means the current status no longer has it. */
const availableChoice = (
  chosen: SubmissionReviewStatus | null,
  moves: readonly SubmissionReviewStatus[],
): SubmissionReviewStatus | null => (chosen && moves.includes(chosen) ? chosen : null);

function ReviewStatusTag({ status }: Readonly<{ status: SubmissionReviewStatus }>) {
  const dictReview = useDictionary().submission.review;
  return <StatusTag label={dictReview.statuses[status]} variant={workflowStateToVariant(status)} />;
}

/** Current status and assignee of a submission, the controls to change them, and its history. */
export function SubmissionStatusPanel({
  review,
  canUpdate = false,
  updatesOff = false,
  reviewers = [],
  currentUserId = null,
  onUpdate,
}: Readonly<SubmissionStatusPanelProps>) {
  const dictReview = useDictionary().submission.review;
  const formatLongDate = useFormatLongDate();
  const [chosenStatus, setChosenStatus] = useState<SubmissionReviewStatus | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [attachComment, setAttachComment] = useState(false);
  // The design system's character count keeps its own tally, so a cleared box is a new one.
  const [commentBox, setCommentBox] = useState(0);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const current = review.statusHistory[0];
  const moves = nextSubmissionStatuses(current?.status);
  const status = availableChoice(chosenStatus, moves);
  const assigning = status === SubmissionReviewStatuses.assigned;
  const moveHint = moveHintOf(current?.status, status);
  const meIsReviewer = reviewers.some((reviewer) => reviewer.id === currentUserId);

  const update = async () => {
    if (!status || !onUpdate) return;
    setSaving(true);
    const note = comment.trim();
    const saved = await onUpdate({
      status,
      assigneeId: assigning ? assigneeId : null,
      ...(note ? { comment: note, attachCommentToEmail: attachComment } : {}),
    });
    setSaving(false);
    if (!saved) return;
    setChosenStatus(null);
    setAssigneeId(null);
    setComment('');
    setAttachComment(false);
    setCommentBox((box) => box + 1);
  };

  const historyColumns: Column<SubmissionStatusChange>[] = useMemo(
    () => [
      {
        key: 'status',
        label: dictReview.status,
        render: (change) => <ReviewStatusTag status={change.status} />,
      },
      {
        key: 'changedAt',
        label: dictReview.dateStatusChanged,
        render: (change) => formatLongDate(change.changedAt),
      },
      {
        key: 'assignee',
        label: dictReview.assignee,
        render: (change) => (change.assignee ? reviewerLabel(change.assignee) : ''),
      },
      { key: 'updatedBy', label: dictReview.updatedBy },
    ],
    [dictReview, formatLongDate],
  );

  // A submission that was never submitted has no review yet.
  if (!current) {
    return (
      <SecondaryText elementType="p" data-testid="submission-status-none">
        {dictReview.noStatus}
      </SecondaryText>
    );
  }

  const historyButton = (
    <Button
      type="button"
      variant="secondary"
      onPress={() => setHistoryOpen(true)}
      data-testid="submission-status-history"
    >
      {dictReview.viewHistory}
    </Button>
  );

  return (
    <div className="d-block w-100">
      <div data-testid="submission-status-current">
        <strong>{dictReview.currentStatus}:</strong> <ReviewStatusTag status={current.status} />
      </div>
      <div className="mb-3" data-testid="submission-status-assignee">
        <strong>{dictReview.assignedTo}:</strong>{' '}
        {current.assignee ? reviewerLabel(current.assignee) : dictReview.unassigned}
      </div>
      {updatesOff ? (
        <SecondaryText elementType="p" data-testid="submission-status-updates-off">
          {dictReview.statusUpdatesOff}
        </SecondaryText>
      ) : null}
      {canUpdate && moves.length > 0 ? (
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            void update();
          }}
        >
          <Select
            label={dictReview.assignOrUpdate}
            placeholder={dictReview.selectPlaceholder}
            value={status}
            isRequired
            isDisabled={saving}
            onChange={(key) => setChosenStatus(key as SubmissionReviewStatus)}
            items={moves.map((id) => ({ id, label: dictReview.statuses[id] }))}
            data-testid="submission-status-select"
          />
          {moveHint ? (
            <div className="mt-2">
              <SecondaryText elementType="p" data-testid="submission-status-move-hint">
                {dictReview[moveHint]}
              </SecondaryText>
            </div>
          ) : null}
          {assigning ? (
            <div className="mt-3">
              <Select
                label={dictReview.assignTo}
                placeholder={dictReview.selectPlaceholder}
                description={dictReview.assignToHint}
                value={assigneeId}
                isRequired
                isDisabled={saving}
                onChange={(key) => setAssigneeId(key as string)}
                items={reviewers.map((reviewer) => ({
                  id: reviewer.id,
                  label: reviewerLabel(reviewer),
                }))}
                data-testid="submission-status-assignee-select"
              />
              {meIsReviewer && currentUserId ? (
                <div className="text-end mt-2">
                  <Link
                    onPress={() => setAssigneeId(currentUserId)}
                    data-testid="submission-status-assign-me"
                  >
                    {dictReview.assignToMe}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3">
            <TextArea
              key={commentBox}
              className="bcds-react-aria-TextArea w-100"
              label={dictReview.statusComment}
              description={dictReview.statusCommentHint}
              maxLength={SUBMISSION_NOTE_MAX_LENGTH}
              value={comment}
              isDisabled={saving}
              onChange={setComment}
              data-testid="submission-status-comment"
            />
            <Checkbox
              isSelected={attachComment && !!comment.trim()}
              isDisabled={saving || !comment.trim()}
              onChange={setAttachComment}
              data-testid="submission-status-attach-comment"
            >
              {dictReview.attachCommentToEmail}
            </Checkbox>
          </div>
          <div className="d-flex gap-2 mt-3">
            <Button
              type="submit"
              isDisabled={saving || !status || (assigning && !assigneeId)}
              data-testid="submission-status-update"
            >
              {dictReview.update}
            </Button>
            {historyButton}
          </div>
        </Form>
      ) : (
        historyButton
      )}
      <SubmissionHistoryModal
        show={historyOpen}
        title={dictReview.statusHistoryTitle}
        columns={historyColumns}
        rows={review.statusHistory}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}
