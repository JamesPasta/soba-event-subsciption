'use client';

import { useMemo, useRef, useState } from 'react';
import { InlineAlert } from '@bcgov/design-system-react-components';

import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import InheritCheckbox from '@/src/features/form-settings/ui/InheritCheckbox';
import { useInheritableEdit } from '@/src/features/form-settings/ui/useInheritableEdit';
import type { FormSettingsSectionProps } from '@/src/features/form-settings/types';
import { useFormSettings } from '@/src/features/form-settings/data/useFormSettings';
import {
  AUDIENCE_SETTINGS_KEY,
  type FormAudienceSettings,
  type SetFormAudienceSettingsBody,
} from '@/src/types/formSettings';
import { useLoginProviders } from '@/src/shared/api/useLoginProviders';
import { messageForDataError } from '@/src/shared/api/dataError';
import { isConflict } from '@/src/shared/api/sobaHelpers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import AudienceField, { isValidAudience, toAudience, type AudienceValue } from './AudienceField';

export default function FormAudienceDrawer({ dict, drawerName, formId }: FormSettingsSectionProps) {
  const t = dict.form.settings;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const {
    settings,
    error: settingsError,
    save,
  } = useFormSettings<FormAudienceSettings, SetFormAudienceSettingsBody>(
    AUDIENCE_SETTINGS_KEY,
    formId,
  );
  const { data: providers, error: providersError } = useLoginProviders();
  const edit = useInheritableEdit<AudienceValue>(settings);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [confirmingPublic, setConfirmingPublic] = useState(false);

  const readError = settingsError ?? providersError;
  const readErrorMessage = useMemo(
    () =>
      readError
        ? messageForDataError(readError, {
            sessionExpired: dict.general.sessionExpired,
            forbidden: dict.general.noAccess,
            failed: t.audienceLoadError,
          })
        : null,
    [readError, dict.general.sessionExpired, dict.general.noAccess, t.audienceLoadError],
  );

  // Providers are needed to show and check a protected audience, so nothing changes until both load.
  const offered = providers ?? [];
  const loaded = !!settings && !!providers;
  const body = edit.body();
  const canSave =
    loaded &&
    !saving &&
    edit.changed &&
    !!body &&
    (body.inherit === true || isValidAudience(body.values, offered));

  // A save that opens the form to everyone is confirmed first, whether it sets Public or inherits a
  // Public workspace.
  let nextAudience = null;
  if (body) {
    nextAudience = body.inherit === true ? settings?.workspace : toAudience(body.values, offered);
  }
  const widensToPublic = nextAudience?.mode === 'public' && settings?.effective.mode !== 'public';

  const saveChanges = async () => {
    if (!token || !canSave || !body || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await save(
        token,
        body.inherit === true
          ? body
          : { inherit: false, values: toAudience(body.values, offered), version: body.version },
      );
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
      setConfirmingPublic(false);
    }
  };

  const requestSave = () => {
    if (widensToPublic) setConfirmingPublic(true);
    else void saveChanges();
  };

  return (
    <FormSettingsDrawers
      dict={dict}
      id={drawerName}
      label={t.audienceDrawerLabel}
      onSave={requestSave}
      onCancel={edit.reset}
      canSave={canSave}
    >
      {readErrorMessage && (
        <InlineAlert
          variant="warning"
          title={readErrorMessage}
          data-testid="form-settings-audience-error"
        />
      )}
      <InheritCheckbox
        label={t.inheritWorkspaceLabel}
        isSelected={edit.inherit}
        onChange={edit.setInherit}
        isDisabled={!loaded || saving}
        testId="form-settings-audience-inherit"
      />
      {edit.values && (
        <AudienceField
          dict={dict}
          value={edit.values}
          onChange={edit.setValues}
          providers={offered}
          isDisabled={!loaded || saving || edit.inherit}
        />
      )}
      <ConfirmModal
        show={confirmingPublic}
        title={t.audienceFormPublicConfirmTitle}
        message={t.audienceFormPublicConfirmMessage}
        confirmLabel={t.audiencePublicConfirmLabel}
        onConfirm={() => void saveChanges()}
        onCancel={() => setConfirmingPublic(false)}
        pending={saving}
      />
    </FormSettingsDrawers>
  );
}
