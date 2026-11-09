'use client';

import { useMemo, useRef, useState } from 'react';
import { InlineAlert } from '@bcgov/design-system-react-components';

import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import type { WorkspaceSettingsSectionProps } from '@/src/features/form-settings/types';
import { useWorkspaceSettings } from '@/src/features/form-settings/data/useWorkspaceSettings';
import { useInheritingFormCount } from '@/src/features/form-settings/data/useInheritingFormCount';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { AUDIENCE_SETTINGS_KEY, type Audience } from '@/src/types/formSettings';
import { useLoginProviders } from '@/src/shared/api/useLoginProviders';
import { messageForDataError } from '@/src/shared/api/dataError';
import { isConflict } from '@/src/shared/api/sobaHelpers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import AudienceField, { isValidAudience, toAudience, type AudienceValue } from './AudienceField';

/** The audience a workspace's forms use unless they set their own. */
export default function WorkspaceAudienceDrawer({
  dict,
  drawerName,
  workspaceId,
}: WorkspaceSettingsSectionProps) {
  const t = dict.form.settings;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const {
    settings,
    error: settingsError,
    save,
  } = useWorkspaceSettings<Audience>(AUDIENCE_SETTINGS_KEY, workspaceId);
  const { data: providers, error: providersError } = useLoginProviders();

  // An edit layered over the loaded value. Null means no edit, so a refresh shows through until the
  // user changes it.
  const [edited, setEdited] = useState<AudienceValue | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // Widening to Public reaches every form that uses the workspace setting, so it is confirmed first,
  // with the count of those forms read for each confirmation.
  const [confirmingPublic, setConfirmingPublic] = useState(false);
  const [confirmations, setConfirmations] = useState(0);
  const inheritingForms = useInheritingFormCount(
    AUDIENCE_SETTINGS_KEY,
    workspaceId,
    confirmingPublic ? confirmations : null,
  );

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
  const value = edited ?? settings?.values ?? null;
  const canSave =
    loaded && !saving && edited !== null && !!value && isValidAudience(value, offered);
  const widensToPublic = value?.mode === 'public' && settings?.values.mode !== 'public';

  const saveChanges = async () => {
    if (!token || !canSave || !value || !settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await save(token, { values: toAudience(value, offered), version: settings.version });
      setEdited(null);
      addNotification({ type: 'success', text: t.formSettingsDrawerSaveSuccessMessage });
    } catch (err) {
      // Someone else saved first: the hook has read their change, so the stale edit goes.
      if (isConflict(err)) setEdited(null);
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
    if (!widensToPublic) {
      void saveChanges();
      return;
    }
    setConfirmations((count) => count + 1);
    setConfirmingPublic(true);
  };

  let confirmMessage = t.audiencePublicConfirmMessage;
  if (inheritingForms.count !== null) {
    confirmMessage += ` ${t.audienceInheritingForms.replace('{count}', String(inheritingForms.count))}`;
  } else if (inheritingForms.failed) {
    confirmMessage += ` ${t.audienceInheritingFormsUnknown}`;
  }

  return (
    <FormSettingsDrawers
      dict={dict}
      id={drawerName}
      label={t.audienceDrawerLabel}
      onSave={requestSave}
      onCancel={() => setEdited(null)}
      canSave={canSave}
    >
      {readErrorMessage && (
        <InlineAlert
          variant="warning"
          title={readErrorMessage}
          data-testid="workspace-settings-audience-error"
        />
      )}
      {value && (
        <AudienceField
          dict={dict}
          value={value}
          onChange={setEdited}
          providers={offered}
          isDisabled={!loaded || saving}
        />
      )}
      <ConfirmModal
        show={confirmingPublic}
        title={t.audiencePublicConfirmTitle}
        message={confirmMessage}
        confirmLabel={t.audiencePublicConfirmLabel}
        onConfirm={() => void saveChanges()}
        onCancel={() => setConfirmingPublic(false)}
        pending={saving}
        confirmDisabled={inheritingForms.loading}
      />
    </FormSettingsDrawers>
  );
}
