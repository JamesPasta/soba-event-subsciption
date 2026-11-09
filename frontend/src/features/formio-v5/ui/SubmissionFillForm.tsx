'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormType, Submission } from '@formio/react';
import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import type { ApiErrorCode } from '@soba/lib';
import { normalizeFormioRenderError } from '@/src/features/formio-v5/normalizeFormioRenderError';
import { FormioV5FormRenderErrorBoundary } from '@/src/features/formio-v5/ui/FormioV5FormRenderErrorBoundary';
import { DynamicForm } from '@/src/features/formio-v5/ui/DynamicForm';
import {
  BLOCKED_REASON,
  useFillWriter,
  type SaveStatus,
} from '@/src/features/formio-v5/data/useFillWriter';
import {
  clearActiveSubmission,
  setActiveOpener,
  setActiveSubmission,
} from '@/src/features/formio-v5/activeSubmission';
import { isFormUpdated } from '@/src/features/formio-v5/data/useSubmissionOpener';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { apiErrorMessage, isNetworkError, isOutcomeUnknown } from '@/src/shared/api/dataError';
import { useFormatTime } from '@/src/shared/hooks/useFormatLongDate';
import type {
  SubmitFillBundle,
  SubmitFormVersionSchemaResponse,
  SubmitterForm,
} from '@/src/types/forms';

export type FillLabels = {
  loading: string;
  loadError: string;
  rendererError: string;
  submitSuccess: string;
  sessionExpired: string;
  readOnly: string;
  saveDraft: string;
  savingDraft: string;
  /** "{time}" is replaced with the time of day. */
  savedAt: string;
  notSaved: string;
  /** A save that got a server failure or no response, so it may have landed. */
  notConfirmed: string;
  offline: string;
  heldSave: string;
  heldSubmit: string;
  reloadLatest: string;
  saveMine: string;
  submitMine: string;
  alreadySubmitted: string;
  requestFailed: string;
  formUpdated: string;
  continueUpdated: string;
  errors: Record<ApiErrorCode, string>;
};

/** One loaded bundle and what the caller may do with it. */
export type FillView = {
  snapshot: SubmitFillBundle;
  canWrite: boolean;
  canSaveDraft: boolean;
  /** Form.io options for the BCGovFile component. */
  fileOption: Record<string, unknown>;
  /** The page's session, which every write goes out as. */
  signedIn: boolean;
  /** Opens a submission not opened yet, from the version this view shows, and returns its head. */
  open?: () => Promise<string>;
};

/** A newer version of the form, with its facts as read with it. */
type NewerVersion = {
  version: SubmitFormVersionSchemaResponse;
  form: SubmitterForm;
};

/** A newer version to move a submission not opened yet to, with the answers typed so far. */
export type FormUpdate = NewerVersion & {
  data: Record<string, unknown>;
};

type FormInstance = {
  emit: (event: string, ...args: unknown[]) => void;
  submit: () => Promise<unknown>;
  setSubmission: (submission: { data: Record<string, unknown> }) => Promise<unknown>;
  submission: { data?: Record<string, unknown> };
  /** Form.io's blur, scheduled to run a moment after a field loses focus. */
  pendingBlur?: { cancel?: () => void } | null;
};

/**
 * Fills one loaded bundle of a submission: saves drafts and submits. A submission not opened yet is
 * opened by its first write or upload, through the view's `open`. It reads its view once, when it
 * mounts, so a re-render with a new bundle object never reaches Form.io; showing a newly loaded
 * bundle mounts a new form.
 */
export function SubmissionFillForm({
  submissionId,
  submissionPath,
  view,
  labels,
  onReload,
  onFormUpdated,
}: Readonly<{
  submissionId: string;
  /** The submission's read-only view, for a submitted record. */
  submissionPath: string;
  view: FillView;
  labels: FillLabels;
  /** Loads the latest bundle and mounts a new form on it. */
  onReload: () => Promise<void>;
  /** Moves a submission not opened yet to a newer version of the form. */
  onFormUpdated?: (update: FormUpdate) => void;
}>) {
  const [{ snapshot, canWrite, canSaveDraft, fileOption, signedIn, open }] = useState(view);
  const { addNotification } = useNotificationStore();
  const router = useRouter();
  const writer = useFillWriter(submissionId, {
    headRevisionId: snapshot.headRevisionId,
    signedIn,
    open,
  });
  const { busy, held, save: saveStatus } = writer.status;
  const formatTime = useFormatTime();

  const [renderError, setRenderError] = useState<string | null>(null);
  // A newer version of the form, found by an open; the filler moves over to it.
  const [updated, setUpdated] = useState<NewerVersion | null>(null);
  // The live Form.io webform: a save reads its answers, "Submit my version" submits it, and a failed
  // submit must emit on it or its button spins forever.
  const formInstanceRef = useRef<FormInstance | null>(null);
  // True once the loaded answers are in the webform.
  const [formReady, setFormReady] = useState(false);

  // A field that loses focus as the form unmounts, as when a click mounts a new one, leaves Form.io
  // a blur to run a moment later on the destroyed webform, where it throws.
  useEffect(() => {
    const instance = formInstanceRef;
    return () => instance.current?.pendingBlur?.cancel?.();
  }, []);

  // Expose the submission being filled, its session and, while it is not opened yet, how to open it,
  // to the CHEFS upload provider; clear it when leaving so a stale id can't tag an unrelated upload
  // (e.g. a designer preview).
  const { ensureOpened } = writer;
  useEffect(() => {
    setActiveSubmission({ submissionId, signedIn });
    setActiveOpener(
      open
        ? () =>
            ensureOpened().catch((err: unknown) => {
              if (isFormUpdated(err)) setUpdated({ version: err.version, form: err.form });
              throw err;
            })
        : null,
    );
    return () => clearActiveSubmission();
  }, [submissionId, signedIn, open, ensureOpened]);

  const schema = snapshot.schema as FormType;
  // Built from the snapshot, so they keep their identity for the life of the form: Form.io resets
  // typed answers when its submission prop changes.
  const submissionProp = useMemo(
    () => ({ data: (snapshot.content?.data ?? {}) as Submission['data'] }),
    [snapshot],
  );
  // We own all submit messaging (success toast + redirect, inline error), so suppress Form.io's
  // built-in green "Submission Complete" alert.
  const formOptions = useMemo(
    () => ({ noAlerts: true, readOnly: !canWrite, ...fileOption }),
    [canWrite, fileOption],
  );

  // @formio/react applies the submission prop only after this callback, and Form.io applies it
  // asynchronously, so the loaded answers are set here and saving waits for them.
  const onFormReady = useCallback(
    (instance: FormInstance) => {
      formInstanceRef.current = instance;
      void instance.setSubmission(submissionProp).then(() => setFormReady(true));
    },
    [submissionProp],
  );

  // Submitted elsewhere, so there is nothing left to fill.
  const leaveClosed = () => {
    addNotification({ text: labels.alreadySubmitted, type: 'warning' });
    router.replace(submissionPath);
  };

  const errorMessage = (err: unknown) => {
    if (isNetworkError(err)) return labels.offline;
    return (
      apiErrorMessage(err, labels.errors, labels.requestFailed) ??
      normalizeFormioRenderError(err, labels.rendererError, labels.sessionExpired)
    );
  };
  const writeError = (err: unknown) => setRenderError(errorMessage(err));

  const saveStatusText = (status: SaveStatus): string => {
    switch (status.state) {
      case 'idle':
        return '';
      case 'saving':
        return labels.savingDraft;
      case 'saved':
        return labels.savedAt.replace('{time}', formatTime(status.at.toISOString()));
      case 'held':
        return labels.notSaved;
      case 'failed': {
        // The notice says why, and what to do.
        if (isFormUpdated(status.cause)) return labels.notSaved;
        const prefix = isOutcomeUnknown(status.cause) ? labels.notConfirmed : labels.notSaved;
        return `${prefix} ${errorMessage(status.cause)}`;
      }
    }
  };

  // Releases Form.io's submit button without its success state.
  const releaseSubmit = (message = '') => formInstanceRef.current?.emit('submitError', message);

  // Saves the answers as they are, without Form.io's validation. The status line reports the result,
  // a failure included.
  const saveDraft = async () => {
    const instance = formReady ? formInstanceRef.current : null;
    if (!instance || !writer.hasBase()) return;
    setRenderError(null);
    const outcome = await writer.save(instance.submission.data ?? {}).catch((err: unknown) => {
      if (isFormUpdated(err)) setUpdated({ version: err.version, form: err.form });
      return null;
    });
    if (outcome?.status === 'held' && outcome.reason === 'closed') leaveClosed();
  };

  const submitForm = async (submission: Submission) => {
    if (!writer.hasBase()) {
      setRenderError(labels.loadError);
      releaseSubmit();
      return;
    }
    try {
      const outcome = await writer.submit((submission?.data ?? {}) as Record<string, unknown>);
      switch (outcome.status) {
        case 'applied':
          addNotification({ text: labels.submitSuccess, type: 'success' });
          // Straight to the confirmation; navigating away unmounts the form, so there's no need to
          // emit `submitDone` and no flash of Form.io's own success screen. replace, so Back does
          // not return to the fill page of a submitted record.
          router.replace(`${submissionPath}/success`);
          break;
        case 'held':
          // A blocked submit sent nothing, so a message on screen still stands.
          if (outcome.reason === 'closed') leaveClosed();
          else if (outcome.reason !== BLOCKED_REASON) setRenderError(null);
          releaseSubmit();
          break;
        case 'queued':
          releaseSubmit();
          break;
      }
    } catch (err) {
      if (isFormUpdated(err)) {
        setUpdated({ version: err.version, form: err.form });
        releaseSubmit();
        return;
      }
      writeError(err);
      releaseSubmit(labels.rendererError);
    }
  };

  // Mounts the newer version with the answers typed so far; nothing is sent until the filler writes.
  const continueUpdated = () => {
    if (!updated) return;
    onFormUpdated?.({ ...updated, data: formInstanceRef.current?.submission.data ?? {} });
  };

  // Discards the typed answers: the container mounts a new form on the latest bundle.
  const reloadLatest = () => writer.discardMine(onReload);

  // Writes the typed answers over the current head. A submit goes through Form.io again, so an
  // invalid form shows its field errors and never reaches submitForm.
  const writeMine = async () => {
    const kept = await writer.keepMine();
    if (kept === 'closed') {
      leaveClosed();
    } else if (kept === 'save') {
      await saveDraft();
    } else if (kept === 'submit') {
      await formInstanceRef.current?.submit().catch(() => undefined);
    }
  };

  return (
    <>
      {renderError ? (
        <InlineAlert variant="danger" role="alert" data-testid="submission-fill-render-error">
          {renderError}
        </InlineAlert>
      ) : null}
      {canWrite ? null : (
        <InlineAlert variant="info" data-testid="submission-fill-readonly">
          {labels.readOnly}
        </InlineAlert>
      )}
      {updated ? (
        <div className="mb-3">
          <InlineAlert
            variant="warning"
            title={labels.formUpdated}
            role="status"
            data-testid="submission-fill-form-updated"
            buttons={
              <Button
                size="small"
                variant="primary"
                onPress={continueUpdated}
                data-testid="submission-fill-continue-updated"
              >
                {labels.continueUpdated}
              </Button>
            }
          />
        </div>
      ) : null}
      {held ? (
        <div className="mb-3">
          <InlineAlert
            variant="warning"
            // BCDS names the alert from `title`; without it the notice has no accessible name.
            title={held === 'save' ? labels.heldSave : labels.heldSubmit}
            role="status"
            data-testid="submission-fill-held"
            buttons={
              <>
                <Button
                  size="small"
                  variant="secondary"
                  onPress={() => {
                    reloadLatest().catch(writeError);
                  }}
                  isDisabled={busy !== null}
                  data-testid="submission-fill-reload-latest"
                >
                  {labels.reloadLatest}
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  onPress={() => {
                    writeMine().catch(writeError);
                  }}
                  isDisabled={busy !== null}
                  data-testid="submission-fill-write-mine"
                >
                  {held === 'save' ? labels.saveMine : labels.submitMine}
                </Button>
              </>
            }
          />
        </div>
      ) : null}
      {canSaveDraft ? (
        <div className="mb-3 d-flex gap-2" data-testid="submission-fill-actions">
          <Button
            variant="secondary"
            onPress={() => {
              saveDraft().catch(writeError);
            }}
            isDisabled={!formReady || busy !== null || held !== null || updated !== null}
            data-testid="submission-fill-save-draft"
          >
            {labels.saveDraft}
          </Button>
          <output className="align-self-center" data-testid="submission-fill-save-status">
            {saveStatusText(saveStatus)}
          </output>
        </div>
      ) : null}
      <FormioV5FormRenderErrorBoundary
        fallback={
          <InlineAlert variant="danger" role="alert">
            {labels.rendererError}
          </InlineAlert>
        }
      >
        <div className="formio-v5-chrome" data-soba-formio-chrome data-testid="submission-fill">
          <DynamicForm
            className="formio-v5-form-root"
            src=""
            form={schema}
            submission={submissionProp}
            options={formOptions}
            onFormReady={onFormReady}
            onError={(err) => {
              setRenderError(
                normalizeFormioRenderError(err, labels.loadError, labels.sessionExpired),
              );
            }}
            onSubmit={submitForm}
          />
        </div>
      </FormioV5FormRenderErrorBoundary>
    </>
  );
}
