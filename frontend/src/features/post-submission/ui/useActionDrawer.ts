'use client';

import { useRef, useState } from 'react';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import type { FieldState } from '@/src/features/post-submission/actions/types';
import { ApiError, isConflict } from '@/src/shared/api/sobaHelpers';
import type { Dictionary } from '@/src/types/dictionary';

const saveErrorText = (dict: Dictionary, err: unknown): string => {
  if (isConflict(err)) return dict.form.settings.settingsConflictMessage;
  if (err instanceof ApiError && err.status === 400) return dict.postSubmission.notAccepted;
  return dict.form.settings.formSettingsDrawerSaveErrorMessage;
};

/**
 * The save and the field state of one action's drawer. A save runs one at a time and says how it
 * went; the server's own wording of a refusal goes to the console only. `reset` drops the edit and
 * remounts the fields, which clears their text; it runs after a save lands, and after one refused
 * because someone else saved first, whose change the settings hook has read by then.
 */
export function useActionDrawer(dict: Dictionary, dropEdit: () => void) {
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [editorKey, setEditorKey] = useState(0);
  const [fieldState, setFieldState] = useState<FieldState>('clear');

  const reset = () => {
    dropEdit();
    setFieldState('clear');
    setEditorKey((key) => key + 1);
  };

  const run = async (write: (token: string) => Promise<void>): Promise<void> => {
    if (!token || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await write(token);
      reset();
      addNotification({
        type: 'success',
        text: dict.form.settings.formSettingsDrawerSaveSuccessMessage,
      });
    } catch (err) {
      if (isConflict(err)) reset();
      addNotification({ type: 'error', text: saveErrorText(dict, err), consoleError: err });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return {
    saving,
    run,
    reset,
    editorKey,
    fieldState,
    setFieldState,
    /** Text waiting in a field counts as a change; leaving the field adds it before the save. */
    pending: fieldState === 'pending',
    invalid: fieldState === 'invalid',
  };
}
