'use client';

import { useMemo } from 'react';
import { useDictionary } from '@/app/[lang]/Providers';
import type { FillLabels } from './SubmissionFillForm';

/** The fill form's copy, for the active language. */
export function useFillLabels(): FillLabels {
  const dict = useDictionary();
  return useMemo(() => {
    const labels = dict.formioV5.formRender;
    return {
      loading: dict.form?.loading || 'Loading…',
      loadError: labels.loadError,
      rendererError: labels.rendererError,
      submitSuccess: labels.submitSuccess,
      sessionExpired: dict.general.sessionExpired,
      readOnly: labels.readOnly,
      saveDraft: labels.saveDraft,
      savingDraft: labels.savingDraft,
      savedAt: labels.savedAt,
      notSaved: labels.notSaved,
      notConfirmed: labels.notConfirmed,
      offline: labels.offline,
      heldSave: labels.heldSave,
      heldSubmit: labels.heldSubmit,
      reloadLatest: labels.reloadLatest,
      saveMine: labels.saveMine,
      submitMine: labels.submitMine,
      alreadySubmitted: labels.alreadySubmitted,
      requestFailed: labels.requestFailed,
      formUpdated: labels.formUpdated,
      continueUpdated: labels.continueUpdated,
      errors: dict.apiErrors,
    };
  }, [dict]);
}
