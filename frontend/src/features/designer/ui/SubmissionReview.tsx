'use client';

import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Key } from 'react-aria-components';
import { usePathname, useRouter } from 'next/navigation';
import type { FormType, Submission } from '@formio/react';
import { Accordion, AccordionGroup, Button } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import type { Column } from '@/src/components/DataTable';
import { WorkflowStateBadge } from '@/src/features/submissions/ui/WorkflowStateBadge';
import { submissionDeleteMessage } from '@/src/features/submissions/submissionDeleteMessage';
import { useSubmissionDeleter } from '@/src/features/designer/data/useFormSubmissions';
import {
  useSubmissionReview,
  useSubmissionReviewers,
} from '@/src/features/designer/data/useSubmissionReview';
import {
  isEditConflict,
  useSubmissionDataEditor,
} from '@/src/features/designer/data/useSubmissionDataEditor';
import { useCurrentUser } from '@/src/shared/api/useCurrentUser';
import { navLink } from '@/src/shared/list/listQueryMemory';
import type { SubmissionEdit } from '@/src/types/submissionReview';
import { useFormatLongDate, useFormatLongDateTime } from '@/src/shared/hooks/useFormatLongDate';
import { useAuthErrorDefaults, useDataErrorNotice } from '@/src/shared/api/useDataErrorNotice';
import { apiErrorMessage } from '@/src/shared/api/dataError';
import { LoadErrorAlert } from '@/src/shared/ui/LoadErrorAlert';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import type { SubmissionDataDocument } from '@/src/types/forms';
import { SubmissionWorkflowState, type SubmissionResponse } from '@/src/types/submissions';
import { SubmissionHistoryModal } from './SubmissionHistoryModal';
import { SubmissionNotesPanel } from './SubmissionNotesPanel';
import { SubmissionAnswersPanel } from './SubmissionAnswersPanel';
import { SubmissionStatusPanel } from './SubmissionStatusPanel';

const PANELS = ['submission-review-status', 'submission-review-notes', 'submission-review-data'];

type SubmissionReviewProps = {
  submission: SubmissionResponse;
  schema: FormType | null;
  /** null = no engine document (no saved answers); `{}` data = empty answers on a real document. */
  content: SubmissionDataDocument | null;
  /** Told whether there are changed answers a move away from the page would lose. */
  onUnsavedEditChange?: (unsaved: boolean) => void;
};

/** The panels the user has open, and every panel while the page prints, so none prints collapsed. */
function usePanelsOpenForPrint(panels: readonly string[]) {
  const [open, setOpen] = useState<Set<Key>>(() => new Set(panels));
  const [printing, setPrinting] = useState(false);
  const all = useMemo(() => new Set<Key>(panels), [panels]);

  useEffect(() => {
    // Synchronous, so the panels are open before the browser lays out the printout.
    const start = () => flushSync(() => setPrinting(true));
    const end = () => setPrinting(false);
    window.addEventListener('beforeprint', start);
    window.addEventListener('afterprint', end);
    return () => {
      window.removeEventListener('beforeprint', start);
      window.removeEventListener('afterprint', end);
    };
  }, []);

  return { expandedKeys: printing ? all : open, onExpandedChange: setOpen };
}

/** Staff's edit of the answers: the copy the form edits, the revision it started from, its changes. */
type AnswersEdit = {
  answers: Submission;
  baseRevisionId: string;
  changed: Record<string, unknown> | null;
};

// Form.io writes to the submission object it is given, so each view gets its own copy of the answers.
const answersCopy = (content: SubmissionDataDocument): Submission => ({
  data: structuredClone(content.data ?? {}) as Submission['data'],
});

function MetaLine({
  label,
  value,
  testId,
}: Readonly<{ label: string; value: string; testId: string }>) {
  return (
    <div data-testid={testId}>
      <strong>{label}:</strong> {value}
    </div>
  );
}

/** Staff review of one submission: its details, status, notes and answers. */
export function SubmissionReview({
  submission,
  schema,
  content,
  onUnsavedEditChange,
}: Readonly<SubmissionReviewProps>) {
  const dict = useDictionary();
  const dictSub = dict.submission;
  const dictReview = dictSub.review;
  const router = useRouter();
  const locale = getLocaleFromPath(usePathname());
  const formatLongDate = useFormatLongDate();
  const formatLongDateTime = useFormatLongDateTime();
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const authDefaults = useAuthErrorDefaults();
  const notifyError = useDataErrorNotice();
  const submissionDeleter = useSubmissionDeleter();
  const { review, canReview, canUpdateStatus, addNote, updateStatus } = useSubmissionReview(
    submission.id,
    submission.formId,
  );
  const reviewers = useSubmissionReviewers(submission.id, canUpdateStatus);
  const currentUserId = useCurrentUser().data?.actor.id ?? null;
  const dataEditor = useSubmissionDataEditor(submission.id, submission.formId);
  const [open, setOpen] = useState<'delete' | 'dataHistory' | 'confirmChange' | null>(null);
  const [edit, setEdit] = useState<AnswersEdit | null>(null);
  const answers = useMemo(() => (content === null ? null : answersCopy(content)), [content]);
  // Staff change only a submitted submission's answers, from the revision on screen.
  const headRevisionId = submission.headRevisionId;
  const canEditData =
    dataEditor.canEdit &&
    submission.workflowState === SubmissionWorkflowState.submitted &&
    !!headRevisionId;
  // Once the answers are no longer staff's to change, the edit is over and does not come back.
  if (edit && !canEditData) setEdit(null);
  const unsavedEdit = !!edit?.changed;
  useEffect(() => {
    onUnsavedEditChange?.(unsavedEdit);
  }, [onUnsavedEditChange, unsavedEdit]);
  const panels = usePanelsOpenForPrint(PANELS);
  // A count, so one write settling does not clear pending while another is still running.
  const [inFlight, setInFlight] = useState(0);
  const pending = inFlight > 0;

  // Runs a write and reports how it went. Resolves whether it was saved, so a panel keeps what was
  // typed when it was not.
  const run = async (write: (token: string) => Promise<void>, done: string, failed: string) => {
    if (!token) {
      addNotification({ text: dict.general.sessionExpired, type: 'error' });
      return false;
    }
    setInFlight((count) => count + 1);
    try {
      await write(token);
      addNotification({ text: done, type: 'success' });
      return true;
    } catch (e: unknown) {
      // A refusal with a code says why, in the reviewer's language.
      const coded = apiErrorMessage(e, dict.apiErrors);
      notifyError(e, coded ? { failed: coded, forbidden: coded } : { failed });
      return false;
    } finally {
      setInFlight((count) => count - 1);
    }
  };

  const remove = async () => {
    await run(
      async (current) => {
        await submissionDeleter.remove(current, submission.id);
        router.push(navLink(`/${locale}/build/${submission.formId}?tab=submissions`));
      },
      dictSub.deleteSuccess,
      dictSub.deleteFailure,
    );
    setOpen(null);
  };

  const startEdit = () => {
    if (content && headRevisionId) {
      setEdit({ answers: answersCopy(content), baseRevisionId: headRevisionId, changed: null });
    }
  };

  const saveData = async () => {
    if (!edit?.changed) return;
    const { changed, baseRevisionId } = edit;
    const saved = await run(
      async (current) => {
        try {
          await dataEditor.save(current, changed, baseRevisionId);
        } catch (e: unknown) {
          // The page has re-read where it now stands, which this edit no longer starts from.
          if (isEditConflict(e)) setEdit(null);
          throw e;
        }
      },
      dictReview.dataUpdated,
      dictReview.saveFailure,
    );
    setOpen(null);
    if (saved) setEdit(null);
  };

  const editColumns: Column<SubmissionEdit>[] = useMemo(
    () => [
      { key: 'editedBy', label: dictReview.username },
      {
        key: 'editedAt',
        label: dictReview.date,
        render: (edit) => formatLongDateTime(edit.editedAt),
      },
    ],
    [dictReview, formatLongDateTime],
  );

  const lastEdit = review.data?.editHistory[0];
  const submitter = submission.createdBy || dictSub.anon;

  return (
    <>
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div data-testid="submission-view-header">
          <WorkflowStateBadge
            state={submission.workflowState}
            data-testid="submission-view-status"
          />
          {submission.submittedAt ? (
            <MetaLine
              label={dictReview.submitted}
              value={formatLongDateTime(submission.submittedAt)}
              testId="submission-view-submitted"
            />
          ) : null}
          {submission.confirmationCode ? (
            <MetaLine
              label={dictSub.confirmationId}
              value={submission.confirmationCode}
              testId="submission-view-confirmation"
            />
          ) : null}
          <MetaLine
            label={dictReview.submittedBy}
            value={submitter}
            testId="submission-view-submitter"
          />
          <MetaLine
            label={dictReview.modified}
            value={formatLongDateTime(lastEdit?.editedAt ?? submission.updatedAt)}
            testId="submission-view-modified"
          />
          <MetaLine
            label={dictReview.modifiedBy}
            value={lastEdit?.editedBy ?? submitter}
            testId="submission-view-modified-by"
          />
        </div>
        <div className="d-print-none">
          <Button
            variant="secondary"
            size="small"
            danger
            onPress={() => setOpen('delete')}
            data-testid="submission-review-delete"
          >
            {dictSub.delete}
          </Button>
        </div>
      </div>

      {review.error ? (
        <LoadErrorAlert
          error={review.error}
          messages={{ ...authDefaults, failed: dictReview.loadError }}
          testIds={{ failed: 'submission-review-loaderror' }}
        />
      ) : null}
      {reviewers.error ? (
        <LoadErrorAlert
          error={reviewers.error}
          messages={{ ...authDefaults, failed: dictReview.reviewersLoadError }}
          testIds={{ failed: 'submission-reviewers-loaderror' }}
        />
      ) : null}
      {review.isLoading ? <CenteredProgress label={dict.general.loading} /> : null}

      {/* The answers are already loaded, so they show whatever happens to the review read. */}
      <AccordionGroup
        allowsMultipleExpanded
        expandedKeys={panels.expandedKeys}
        onExpandedChange={panels.onExpandedChange}
      >
        {review.data ? (
          <>
            <Accordion
              id={PANELS[0]}
              data-testid={`accordion-${PANELS[0]}`}
              label={dictReview.status}
            >
              <SubmissionStatusPanel
                review={review.data}
                canUpdate={canUpdateStatus}
                updatesOff={canReview && !canUpdateStatus}
                reviewers={reviewers.data?.items}
                currentUserId={currentUserId}
                onUpdate={(change) =>
                  run(
                    (current) => updateStatus(current, change),
                    dictReview.statusUpdated,
                    dictReview.saveFailure,
                  )
                }
              />
            </Accordion>
            <Accordion
              id={PANELS[1]}
              data-testid={`accordion-${PANELS[1]}`}
              label={dictReview.notes}
            >
              <SubmissionNotesPanel
                notes={review.data.notes}
                canAdd={canReview}
                onAdd={(text) =>
                  run(
                    (current) => addNote(current, text),
                    dictReview.noteAdded,
                    dictReview.saveFailure,
                  )
                }
              />
            </Accordion>
          </>
        ) : null}
        <Accordion
          id={PANELS[2]}
          data-testid={`accordion-${PANELS[2]}`}
          label={dictReview.submissionHeading}
        >
          <SubmissionAnswersPanel
            schema={schema}
            answers={answers}
            versionNo={submission.versionNo ?? 1}
            editAnswers={edit?.answers ?? null}
            changed={unsavedEdit}
            pending={pending}
            canEdit={canEditData}
            hasHistory={!!submission.submittedAt && !!review.data}
            onEdit={startEdit}
            onDataChange={(changed) => setEdit((current) => current && { ...current, changed })}
            onUpdate={() => setOpen('confirmChange')}
            onCancel={() => setEdit(null)}
            onHistory={() => setOpen('dataHistory')}
          />
        </Accordion>
      </AccordionGroup>

      <ConfirmModal
        show={open === 'delete'}
        title={dictSub.deleteTitle}
        message={submissionDeleteMessage(dictSub, submission, formatLongDate)}
        confirmLabel={dictSub.delete}
        onConfirm={() => void remove()}
        onCancel={() => setOpen(null)}
        pending={pending}
      />
      <ConfirmModal
        show={open === 'confirmChange'}
        title={dictReview.confirmChangeTitle}
        message={dictReview.confirmChangeMessage}
        confirmLabel={dictReview.update}
        onConfirm={() => void saveData()}
        onCancel={() => setOpen(null)}
        pending={pending}
      />
      <SubmissionHistoryModal
        show={open === 'dataHistory'}
        title={dictReview.dataHistoryTitle}
        intro={dictReview.dataHistoryIntro}
        columns={editColumns}
        rows={review.data?.editHistory ?? []}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
