'use client';

import { useCallback, useRef, useState } from 'react';
import type { FormType, Submission } from '@formio/react';
import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import {
  EditableFormView,
  type EditableFormInstance,
} from '@/src/features/formio-v5/ui/EditableFormView';
import { ReadOnlyFormView } from '@/src/features/formio-v5/ui/ReadOnlyFormView';

type SubmissionAnswersPanelProps = {
  schema: FormType | null;
  /** The answers on screen; null when the submission has no answer document. */
  answers: Submission | null;
  versionNo: number;
  /** The editor's own copy of the answers; null while the answers only show. */
  editAnswers: Submission | null;
  /** Whether the editor's answers have been changed, which is when they can be saved. */
  changed: boolean;
  /** Whether a write is in flight, which holds the edit buttons. */
  pending: boolean;
  /** Whether the caller may change the answers. */
  canEdit: boolean;
  /** Whether the submission has submitted answers, and so a history of changes to them. */
  hasHistory: boolean;
  onEdit: () => void;
  onDataChange: (data: Record<string, unknown>) => void;
  onUpdate: () => void;
  onCancel: () => void;
  onHistory: () => void;
};

/** A submission's answers, read only or edited by staff, with the buttons for both. */
export function SubmissionAnswersPanel({
  schema,
  answers,
  versionNo,
  editAnswers,
  changed,
  pending,
  canEdit,
  hasHistory,
  onEdit,
  onDataChange,
  onUpdate,
  onCancel,
  onHistory,
}: Readonly<SubmissionAnswersPanelProps>) {
  const dict = useDictionary();
  const dictReview = dict.submission.review;
  const form = useRef<EditableFormInstance | null>(null);
  const [invalid, setInvalid] = useState(false);
  const onFormReady = useCallback((instance: EditableFormInstance) => {
    form.current = instance;
  }, []);

  // The webform marks the invalid fields, so a refused update says which before it reaches the server.
  const update = () => {
    const valid = form.current ? form.current.checkValidity(form.current.data, true) : true;
    setInvalid(!valid);
    if (valid) onUpdate();
  };

  if (!schema || !answers) {
    return (
      <div className="d-block w-100">
        <div className="text-end" data-testid="submission-view-version">
          {dict.general.version}: {versionNo}
        </div>
        <InlineAlert variant="info" role="status" data-testid="submission-view-nocontent">
          {dict.submission.noContent}
        </InlineAlert>
      </div>
    );
  }

  return (
    <div className="d-block w-100">
      <div className="text-end" data-testid="submission-view-version">
        {dict.general.version}: {versionNo}
      </div>
      {editAnswers ? (
        <>
          <InlineAlert
            variant="info"
            role="status"
            title={dictReview.editingNotice}
            data-testid="submission-edit-notice"
          />
          <EditableFormView
            schema={schema}
            submission={editAnswers}
            onDataChange={(data) => {
              setInvalid(false);
              onDataChange(data);
            }}
            onFormReady={onFormReady}
            testId="submission-edit-form"
          />
          {invalid ? (
            <InlineAlert
              variant="danger"
              role="alert"
              title={dictReview.editInvalid}
              data-testid="submission-edit-invalid"
            />
          ) : null}
          <div className="d-flex gap-2 mt-3 d-print-none">
            <Button
              isDisabled={pending || !changed}
              onPress={update}
              data-testid="submission-edit-update"
            >
              {dictReview.update}
            </Button>
            <Button
              variant="secondary"
              isDisabled={pending}
              onPress={() => {
                setInvalid(false);
                onCancel();
              }}
              data-testid="submission-edit-cancel"
            >
              {dictReview.cancelEdit}
            </Button>
          </div>
        </>
      ) : (
        <>
          <ReadOnlyFormView schema={schema} submission={answers} testId="submission-view-form" />
          {hasHistory ? (
            <div className="d-flex gap-2 mt-3 d-print-none">
              {canEdit ? (
                <Button onPress={onEdit} data-testid="submission-edit">
                  {dictReview.editData}
                </Button>
              ) : null}
              <Button variant="secondary" onPress={onHistory} data-testid="submission-data-history">
                {dictReview.viewHistory}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
