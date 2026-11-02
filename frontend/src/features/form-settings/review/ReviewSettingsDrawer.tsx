'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Checkbox, InlineAlert } from '@bcgov/design-system-react-components';

import { useFormSubmissionsRefresh } from '@/src/features/designer/data/useFormSubmissions';
import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import InheritCheckbox from '@/src/features/form-settings/ui/InheritCheckbox';
import { useInheritableEdit } from '@/src/features/form-settings/ui/useInheritableEdit';
import type { FormSettingsSectionProps } from '@/src/features/form-settings/types';
import { useFormSettings } from '@/src/features/form-settings/data/useFormSettings';
import {
  AUDIENCE_SETTINGS_KEY,
  REVIEW_SETTINGS_KEY,
  type FormAudienceSettings,
  type FormReviewSettings,
  type ReviewSettings,
  type SetFormReviewSettingsBody,
} from '@/src/types/formSettings';
import { messageForDataError } from '@/src/shared/api/dataError';
import { isConflict } from '@/src/shared/api/sobaHelpers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';

const OFF: ReviewSettings = { allowStatusUpdates: false, allowSubmitterRevision: false };

/** How the form's submissions are reviewed: inherited from its workspace, or its own. */
export default function ReviewSettingsDrawer({
  dict,
  drawerName,
  formId,
}: FormSettingsSectionProps) {
  const t = dict.form.settings;
  const { token } = useKeycloak();
  const refreshSubmissions = useFormSubmissionsRefresh(formId);
  const {
    settings,
    error: settingsError,
    save,
  } = useFormSettings<FormReviewSettings, SetFormReviewSettingsBody>(REVIEW_SETTINGS_KEY, formId);
  const { addNotification } = useNotificationStore();
  const noteId = useId();

  // Anonymous submissions cannot be revised, so a Public audience gets a note. The setting still
  // applies to signed-in owners, so it stays editable.
  const { settings: audience } = useFormSettings<FormAudienceSettings>(
    AUDIENCE_SETTINGS_KEY,
    formId,
  );
  const isPublic = audience?.effective.mode === 'public';

  const edit = useInheritableEdit<ReviewSettings>(settings);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const readErrorMessage = useMemo(
    () =>
      settingsError
        ? messageForDataError(settingsError, {
            sessionExpired: dict.general.sessionExpired,
            forbidden: dict.general.noAccess,
            failed: t.reviewSettingsLoadError,
          })
        : null,
    [settingsError, dict.general.sessionExpired, dict.general.noAccess, t.reviewSettingsLoadError],
  );

  const canEdit = !!settings;
  const values = (canEdit ? edit.values : null) ?? settings?.effective ?? OFF;
  const inherit = canEdit ? edit.inherit : true;

  const saveChanges = async () => {
    const body = edit.body();
    if (!token || !canEdit || !body || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await save(token, body);
      void refreshSubmissions();
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

  const controlsDisabled = saving || !canEdit || inherit;

  return (
    <FormSettingsDrawers
      dict={dict}
      id={drawerName}
      label={t.reviewSettingsDrawerLabel}
      onSave={saveChanges}
      onCancel={edit.reset}
      canSave={canEdit && edit.changed && !saving}
    >
      {readErrorMessage && (
        <InlineAlert
          variant="warning"
          title={readErrorMessage}
          data-testid="form-settings-review-settings-error"
        />
      )}
      <InheritCheckbox
        label={t.inheritWorkspaceLabel}
        isSelected={inherit}
        onChange={edit.setInherit}
        isDisabled={saving || !canEdit}
        testId="form-settings-review-inherit"
      />
      <Checkbox
        isSelected={values.allowStatusUpdates}
        onChange={(allow) => edit.setValues({ ...values, allowStatusUpdates: allow })}
        isDisabled={controlsDisabled}
        data-testid="form-settings-allow-status-updates"
      >
        {t.allowStatusUpdatesLabel}
      </Checkbox>
      <Checkbox
        isSelected={values.allowSubmitterRevision}
        onChange={(allow) => edit.setValues({ ...values, allowSubmitterRevision: allow })}
        isDisabled={controlsDisabled}
        aria-describedby={isPublic ? noteId : undefined}
        data-testid="form-settings-allow-submitter-revision"
      >
        {t.allowSubmitterRevisionLabel}
      </Checkbox>
      {isPublic && (
        <div id={noteId}>
          <InlineAlert
            variant="info"
            title={t.allowSubmitterRevisionPublicNote}
            data-testid="form-settings-allow-submitter-revision-public-note"
          />
        </div>
      )}
    </FormSettingsDrawers>
  );
}
