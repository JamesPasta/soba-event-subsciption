'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Checkbox, InlineAlert } from '@bcgov/design-system-react-components';

import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import InheritCheckbox from '@/src/features/form-settings/ui/InheritCheckbox';
import { useInheritableEdit } from '@/src/features/form-settings/ui/useInheritableEdit';
import type { FormSettingsSectionProps } from '@/src/features/form-settings/types';
import { useFormSettings } from '@/src/features/form-settings/data/useFormSettings';
import {
  AUDIENCE_SETTINGS_KEY,
  SUBMITTER_SETTINGS_KEY,
  type FormAudienceSettings,
  type FormSubmitterSettings,
  type SetFormSubmitterSettingsBody,
  type SubmitterSettings,
} from '@/src/types/formSettings';
import { messageForDataError } from '@/src/shared/api/dataError';
import { isConflict } from '@/src/shared/api/sobaHelpers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';

export default function SubmitterSettingsDrawer({
  dict,
  drawerName,
  formId,
}: FormSettingsSectionProps) {
  const t = dict.form.settings;
  const { token } = useKeycloak();
  const {
    settings,
    error: settingsError,
    save,
  } = useFormSettings<FormSubmitterSettings, SetFormSubmitterSettingsBody>(
    SUBMITTER_SETTINGS_KEY,
    formId,
  );
  const { addNotification } = useNotificationStore();
  const noteId = useId();

  // Drafts are not offered to a Public audience: the form's own, or its workspace's while it
  // inherits.
  const { settings: audience, error: audienceError } = useFormSettings<FormAudienceSettings>(
    AUDIENCE_SETTINGS_KEY,
    formId,
  );

  const edit = useInheritableEdit<SubmitterSettings>(settings);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const readError = settingsError ?? audienceError;
  const readErrorMessage = useMemo(
    () =>
      readError
        ? messageForDataError(readError, {
            sessionExpired: dict.general.sessionExpired,
            forbidden: dict.general.noAccess,
            failed: t.submitterSettingsLoadError,
          })
        : null,
    [readError, dict.general.sessionExpired, dict.general.noAccess, t.submitterSettingsLoadError],
  );

  // The settings change only once they and the audience are both known. On a Public audience the
  // stored settings stand, including over an edit made before the audience changed.
  const isPublic = audience?.effective.mode === 'public';
  const canEdit = !!settings && !!audience && !isPublic;
  const shown = canEdit ? edit : null;
  const inherit = shown ? shown.inherit : (settings?.inherit ?? true);
  const allowSubmitterDrafts = shown
    ? (shown.values?.allowSubmitterDrafts ?? false)
    : (settings?.effective.allowSubmitterDrafts ?? false);

  const saveChanges = async () => {
    const body = edit.body();
    if (!token || !canEdit || !body || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await save(token, body);
      edit.reset();
      addNotification({ type: 'success', text: t.formSettingsDrawerSaveSuccessMessage });
    } catch (err) {
      // Someone else saved first: the hook has read their change, so the stale edit goes.
      if (isConflict(err)) edit.reset();
      addNotification({
        type: 'error',
        text: isConflict(err) ? t.settingsConflictMessage : t.formSettingsDrawerSaveErrorMessage,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <FormSettingsDrawers
      dict={dict}
      id={drawerName}
      label={t.submitterSettingsDrawerLabel}
      onSave={saveChanges}
      onCancel={edit.reset}
      canSave={canEdit && edit.changed && !saving}
    >
      {readErrorMessage && (
        <InlineAlert
          variant="warning"
          title={readErrorMessage}
          data-testid="form-settings-submitter-settings-error"
        />
      )}
      <InheritCheckbox
        label={t.inheritWorkspaceLabel}
        isSelected={inherit}
        onChange={edit.setInherit}
        isDisabled={saving || !canEdit}
        testId="form-settings-submitter-inherit"
      />
      <Checkbox
        isSelected={allowSubmitterDrafts}
        onChange={(allow) => edit.setValues({ allowSubmitterDrafts: allow })}
        isDisabled={saving || !canEdit || inherit}
        aria-describedby={isPublic ? noteId : undefined}
        data-testid="form-settings-allow-drafts"
      >
        {t.allowSubmitterDraftsLabel}
      </Checkbox>
      {isPublic && (
        <div id={noteId}>
          <InlineAlert
            variant="info"
            title={t.allowSubmitterDraftsPublicNote}
            data-testid="form-settings-allow-drafts-public-note"
          />
        </div>
      )}
    </FormSettingsDrawers>
  );
}
