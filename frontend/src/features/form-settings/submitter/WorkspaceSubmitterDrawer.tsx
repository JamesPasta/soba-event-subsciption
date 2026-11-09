'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Checkbox, InlineAlert } from '@bcgov/design-system-react-components';

import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import type { WorkspaceSettingsSectionProps } from '@/src/features/form-settings/types';
import { useWorkspaceSettings } from '@/src/features/form-settings/data/useWorkspaceSettings';
import {
  AUDIENCE_SETTINGS_KEY,
  SUBMITTER_SETTINGS_KEY,
  type Audience,
  type SubmitterSettings,
} from '@/src/types/formSettings';
import { messageForDataError } from '@/src/shared/api/dataError';
import { isConflict } from '@/src/shared/api/sobaHelpers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';

/**
 * What submitters may do on the workspace's forms unless a form sets its own. A Public workspace
 * keeps the setting: forms with their own audience still use it, and drafts return when the
 * workspace leaves Public.
 */
export default function WorkspaceSubmitterDrawer({
  dict,
  drawerName,
  workspaceId,
}: WorkspaceSettingsSectionProps) {
  const t = dict.form.settings;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const noteId = useId();
  const {
    settings,
    error: settingsError,
    save,
  } = useWorkspaceSettings<SubmitterSettings>(SUBMITTER_SETTINGS_KEY, workspaceId);
  const { settings: audience } = useWorkspaceSettings<Audience>(AUDIENCE_SETTINGS_KEY, workspaceId);

  const [editedAllowDrafts, setEditedAllowDrafts] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const readErrorMessage = useMemo(
    () =>
      settingsError
        ? messageForDataError(settingsError, {
            sessionExpired: dict.general.sessionExpired,
            forbidden: dict.general.noAccess,
            failed: t.submitterSettingsLoadError,
          })
        : null,
    [
      settingsError,
      dict.general.sessionExpired,
      dict.general.noAccess,
      t.submitterSettingsLoadError,
    ],
  );

  const isPublic = audience?.values.mode === 'public';
  const allowSubmitterDrafts = editedAllowDrafts ?? settings?.values.allowSubmitterDrafts ?? false;

  const saveChanges = async () => {
    if (!token || !settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await save(token, { values: { allowSubmitterDrafts }, version: settings.version });
      setEditedAllowDrafts(null);
      addNotification({ type: 'success', text: t.formSettingsDrawerSaveSuccessMessage });
    } catch (err) {
      // Someone else saved first: the hook has read their change, so the stale edit goes.
      if (isConflict(err)) setEditedAllowDrafts(null);
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
      onCancel={() => setEditedAllowDrafts(null)}
      canSave={!!settings && !saving && editedAllowDrafts !== null}
    >
      {readErrorMessage && (
        <InlineAlert
          variant="warning"
          title={readErrorMessage}
          data-testid="workspace-settings-submitter-error"
        />
      )}
      <Checkbox
        isSelected={allowSubmitterDrafts}
        onChange={setEditedAllowDrafts}
        isDisabled={saving || !settings}
        aria-describedby={isPublic ? noteId : undefined}
        data-testid="workspace-settings-allow-drafts"
      >
        {t.allowSubmitterDraftsLabel}
      </Checkbox>
      {isPublic && (
        <div id={noteId}>
          <InlineAlert
            variant="info"
            title={t.allowSubmitterDraftsPublicNote}
            data-testid="workspace-settings-allow-drafts-public-note"
          />
        </div>
      )}
    </FormSettingsDrawers>
  );
}
