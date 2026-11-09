'use client';

import type { FormType, Submission } from '@formio/react';
import { InlineAlert } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { StatusTag, submitterReviewToVariant } from '@/src/components/StatusTag';
import { ReadOnlyFormView } from '@/src/features/formio-v5/ui/ReadOnlyFormView';
import { useFormatLongDate } from '@/src/shared/hooks/useFormatLongDate';
import type { SubmissionDataDocument } from '@/src/types/forms';
import type { SubmissionListItem, SubmitterReviewLabel } from '@/src/types/submissions';
import { WorkflowStateBadge } from './WorkflowStateBadge';

const SEPARATOR = ' \u00B7 ';

type SubmissionDetailProps = {
  submission: SubmissionListItem;
  schema: FormType | null;
  /** null = no engine document (no saved answers); `{}` data = empty answers on a real document. */
  content: SubmissionDataDocument | null;
  showSubmitter?: boolean;
  /** The review as its submitter is told it, shown in place of the workflow state once there is one. */
  reviewLabel?: SubmitterReviewLabel | null;
};

/** A loaded submission: its header and the answers rendered read-only against its schema. */
export function SubmissionDetail({
  submission,
  schema,
  content,
  showSubmitter = false,
  reviewLabel = null,
}: Readonly<SubmissionDetailProps>) {
  const dict = useDictionary();
  const dictSub = dict.submission;
  const formatLongDate = useFormatLongDate();

  return (
    <>
      <div className="mb-3" data-testid="submission-view-header">
        <h2 className="h5 mb-1">{submission.formName || dict.form.nameLabel}</h2>
        {submission.confirmationCode ? (
          <div data-testid="submission-view-confirmation">
            {dictSub.confirmationId}: <strong>{submission.confirmationCode}</strong>
          </div>
        ) : null}
        {showSubmitter ? (
          <div data-testid="submission-view-submitter">
            {dictSub.submitter}: {submission.createdBy || dictSub.anon}
          </div>
        ) : null}
        <div className="small text-muted">
          <span data-testid="submission-view-version">v{submission.versionNo ?? 1}</span>
          {SEPARATOR}
          {reviewLabel ? (
            <StatusTag
              label={dict.mySubmissions.reviewStatuses[reviewLabel]}
              variant={submitterReviewToVariant(reviewLabel)}
              data-testid="submission-view-status"
            />
          ) : (
            <WorkflowStateBadge
              state={submission.workflowState}
              data-testid="submission-view-status"
            />
          )}
          {submission.submittedAt ? (
            <>
              {SEPARATOR}
              <span data-testid="submission-view-submitted">
                {dictSub.submittedOn} {formatLongDate(submission.submittedAt)}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {schema && content !== null ? (
        <ReadOnlyFormView
          schema={schema}
          submission={{ data: (content.data ?? {}) as Submission['data'] }}
          testId="submission-view-form"
        />
      ) : (
        <InlineAlert variant="info" role="status" data-testid="submission-view-nocontent">
          {dictSub.noContent}
        </InlineAlert>
      )}
    </>
  );
}
