'use client';
import { useMemo, useState, useCallback } from 'react';
import { FaRegTrashCan, FaFile } from 'react-icons/fa6';
import { Button, Checkbox, Link, Select } from '@bcgov/design-system-react-components';
import { useRouter, usePathname } from 'next/navigation';

import type { Dictionary } from '@/src/types/dictionary';
import { DataTable, type Column } from '@/src/components/DataTable';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { useFormatLongDate } from '@/src/shared/hooks/useFormatLongDate';
import { SubmissionWorkflowState, type SubmissionListItem } from '@/src/types/submissions';
import {
  SUBMISSION_REVIEW_STATUSES,
  type SubmissionReviewStatus,
} from '@/src/types/submissionReview';
import { Tag } from '@/src/components/Tag';
import { StatusTag, workflowStateToVariant } from '@/src/components/StatusTag';
import { ListPageFilters } from '@/src/components/ListPageLayout';
import { useCurrentUser } from '@/src/shared/api/useCurrentUser';
import { reviewerLabel } from './SubmissionStatusPanel';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import {
  useFormSubmissions,
  useSubmissionDeleter,
} from '@/src/features/designer/data/useFormSubmissions';
import { FORM_SUBMISSIONS_LIST_QUERY, scopedListQuery } from '@/src/shared/list/listQueryMemory';
import { submissionDeleteMessage } from '@/src/features/submissions/submissionDeleteMessage';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { capitalizeFirstLetter } from '@/src/shared/util/stringUtils';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';
import { useFeatureAllowed } from '@/src/shared/api/useFeatureAllowed';

const ALL_STATUSES = 'all';

const toReviewStatus = (raw: string | undefined): SubmissionReviewStatus | undefined =>
  SUBMISSION_REVIEW_STATUSES.find((status) => status === raw);

interface FormSubmissionTabProps {
  dict: Dictionary;
  formId?: string;
  /** True once the tab has been opened; the read waits for that. See useFormSubmissions. */
  opened: boolean;
}

export default function FormSubmissionTab({
  dict,
  formId,
  opened,
}: Readonly<FormSubmissionTabProps>) {
  const listSpec = useMemo(
    () =>
      formId ? scopedListQuery(FORM_SUBMISSIONS_LIST_QUERY, formId) : FORM_SUBMISSIONS_LIST_QUERY,
    [formId],
  );
  const query = useListQuery(listSpec);
  const dictReview = dict.submission.review;
  const currentUserId = useCurrentUser().data?.actor?.id;
  const reviewStatus = toReviewStatus(query.filters.reviewStatus);
  const mine = query.filters.mine === 'true';
  const submissionsResult = useFormSubmissions(
    formId,
    opened,
    { offset: query.offset, limit: query.pageSize, sort: query.sort, q: query.q },
    { reviewStatus, assigneeId: mine ? currentUserId : undefined },
  );
  // The review columns and filters show only when the form's settings let reviewers change status.
  const showReview = submissionsResult.allowStatusUpdates;
  // A filter from a shared link still applies when the review is hidden, so it stays clearable.
  const showFilters = showReview || !!reviewStatus || mine;
  const { setFilters } = query;
  const setReviewFilter = useCallback(
    (next: { reviewStatus?: string; mine?: boolean }) => {
      const status = 'reviewStatus' in next ? next.reviewStatus : reviewStatus;
      const assignedToMe = 'mine' in next ? next.mine : mine;
      setFilters({
        ...(status ? { reviewStatus: status } : {}),
        ...(assignedToMe ? { mine: 'true' } : {}),
      });
    },
    [setFilters, reviewStatus, mine],
  );
  const { table } = useDataTable(query, submissionsResult, dict.submission.error);
  const submissionDeleter = useSubmissionDeleter();
  const formatLongDate = useFormatLongDate();
  const { token } = useKeycloak();
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<SubmissionListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { addNotification } = useNotificationStore();
  const exportsAllowed = useFeatureAllowed(FEATURE_CODES.SUBMISSION_EXPORT);

  const confirmDelete = useCallback(async () => {
    if (!token || !pendingDelete) return;
    setDeleting(true);
    try {
      await submissionDeleter.remove(token, pendingDelete.id);
      addNotification({ text: dict.submission.deleteSuccess, type: 'success' });
    } catch (e: unknown) {
      addNotification({
        text: e instanceof Error && e.message ? e.message : dict.submission.deleteFailure,
        type: 'error',
        consoleError: e,
      });
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }, [token, pendingDelete, submissionDeleter, addNotification, dict]);

  const columns: Column<SubmissionListItem>[] = useMemo(
    () => [
      {
        key: 'confirmationCode',
        label: dict.submission?.confirmationId || 'Confirmation Id',
        render: (sub) => (
          <span data-testid={`${sub.id}-confirmation-id`}>{sub.confirmationCode ?? 'N/A'}</span>
        ),
      },
      {
        key: 'versionNo',
        label: dict.general?.version || 'Version',
        render: (sub) => `v${sub.versionNo || '?'}`,
      },
      {
        key: 'createdBy',
        label: dict.submission?.submitter || 'Submitter',
        render: (sub) => sub.createdBy || dict.submission.anon,
      },
      showReview
        ? {
            key: 'reviewStatus',
            label: dict.form?.status || 'Status',
            sortField: 'reviewStatus',
            render: (sub: SubmissionListItem) =>
              sub.reviewStatus ? (
                <StatusTag
                  data-testid={`${sub.id}-review-status`}
                  label={dictReview.statuses[sub.reviewStatus]}
                  variant={workflowStateToVariant(sub.reviewStatus)}
                />
              ) : (
                <span data-testid={`${sub.id}-review-status`}>{dictReview.notSubmitted}</span>
              ),
          }
        : {
            key: 'workflowState',
            label: dict.form?.status || 'Status',
            render: (sub: SubmissionListItem) => (
              <Tag
                data-testid={`${sub.id}-status-tag`}
                text={capitalizeFirstLetter(sub.workflowState)}
                color={sub.workflowState === SubmissionWorkflowState.submitted ? 'green' : 'grey'}
              />
            ),
          },
      ...(showReview
        ? [
            {
              key: 'assignee',
              label: dictReview.assignedTo,
              sortField: 'assignee',
              render: (sub: SubmissionListItem) => (
                <span data-testid={`${sub.id}-assignee`}>
                  {sub.assignee ? reviewerLabel(sub.assignee) : ''}
                </span>
              ),
            },
          ]
        : []),
      {
        key: 'submittedAt',
        label: dict.submission?.submittedAt || 'Submission Date',
        sortField: 'submittedAt',
        render: (sub) => (
          <span className="small" data-testid={`${sub.id}-submitted-date`}>
            {sub.submittedAt ? formatLongDate(sub.submittedAt) : 'N/A'}
          </span>
        ),
      },
      {
        key: 'actions',
        label: dict.submission?.actions || 'Actions',
        render: (sub) => (
          <>
            <Link
              className="bcds-react-aria-Link medium false me-2"
              aria-label={dict.submission.view}
              data-testid={`${sub.id}-view-link`}
              onPress={() => router.push(`/${locale}/build/${sub.formId}/submissions/${sub.id}`)}
            >
              <FaFile />
            </Link>
            <Link
              className="bcds-react-aria-Link medium false danger"
              data-testid={`${sub.id}-delete-link`}
              aria-label={dict.submission.delete}
              onPress={() => setPendingDelete(sub)}
            >
              <FaRegTrashCan />
            </Link>
          </>
        ),
      },
    ],
    [dict, dictReview, showReview, formatLongDate, locale, router],
  );

  const statusOptions = useMemo(
    () => [
      { id: ALL_STATUSES, label: dictReview.listAllStatuses },
      ...SUBMISSION_REVIEW_STATUSES.map((id) => ({ id, label: dictReview.statuses[id] })),
    ],
    [dictReview],
  );

  return (
    <>
      {exportsAllowed ? (
        <div className="d-flex justify-content-end mb-2">
          <Button
            variant="secondary"
            size="small"
            isDisabled={!formId}
            onPress={() => router.push(`/${locale}/build/${formId}/submissions/exports`)}
            data-testid="submissions-export-button"
          >
            {dict.submission.export.button}
          </Button>
        </div>
      ) : null}
      {showFilters ? (
        <ListPageFilters>
          <Select
            size="medium"
            label={dictReview.listStatusFilter}
            selectedKey={reviewStatus ?? ALL_STATUSES}
            onSelectionChange={(key) =>
              setReviewFilter({
                reviewStatus: key && key !== ALL_STATUSES ? String(key) : undefined,
              })
            }
            items={statusOptions}
            data-testid="form-submissions-review-status-select"
          />
          {currentUserId ? (
            <Checkbox
              isSelected={mine}
              onChange={(selected) => setReviewFilter({ mine: selected })}
              data-testid="form-submissions-mine"
            >
              {dictReview.assignedToMeFilter}
            </Checkbox>
          ) : null}
        </ListPageFilters>
      ) : null}
      <DataTable<SubmissionListItem>
        {...table}
        columns={columns}
        emptyMessage={dict.submission.emptyList}
        loadingMessage={dict.general.loading}
        itemName="submissions"
        caption={dict.submission?.submissions || 'Submissions'}
        keyExtractor={(sub) => sub.id}
      />
      <ConfirmModal
        show={pendingDelete !== null}
        title={dict.submission.deleteTitle}
        message={
          pendingDelete
            ? submissionDeleteMessage(dict.submission, pendingDelete, formatLongDate)
            : ''
        }
        confirmLabel={dict.submission.delete}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
        pending={deleting}
      />
    </>
  );
}
