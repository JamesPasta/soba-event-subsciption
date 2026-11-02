'use client';

import { useMemo, useRef, useState } from 'react';
import { Checkbox, InlineAlert } from '@bcgov/design-system-react-components';

import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import type { WorkspaceSettingsSectionProps } from '@/src/features/form-settings/types';
import { useWorkspaceSettings } from '@/src/features/form-settings/data/useWorkspaceSettings';
import { REVIEW_SETTINGS_KEY, type ReviewSettings } from '@/src/types/formSettings';
import { messageForDataError } from '@/src/shared/api/dataError';
import { isConflict } from '@/src/shared/api/sobaHelpers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';

const OFF: ReviewSettings = { allowStatusUpdates: false, allowSubmitterRevision: false };

/** How submissions are reviewed on the workspace's forms unless a form sets its own. */
export default function WorkspaceReviewDrawer({
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
  } = useWorkspaceSettings<ReviewSettings>(REVIEW_SETTINGS_KEY, workspaceId);

  // Null means no edit, so a refresh shows through until the user changes something.
  const [edited, setEdited] = useState<ReviewSettings | null>(null);
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

  const values = edited ?? settings?.values ?? OFF;

  const saveChanges = async () => {
    if (!token || !settings || !edited || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await save(token, { values: edited, version: settings.version });
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
    }
  };

  return (
    <FormSettingsDrawers
      dict={dict}
      id={drawerName}
      label={t.reviewSettingsDrawerLabel}
      onSave={saveChanges}
      onCancel={() => setEdited(null)}
      canSave={!!settings && !saving && edited !== null}
    >
      {readErrorMessage && (
        <InlineAlert
          variant="warning"
          title={readErrorMessage}
          data-testid="workspace-settings-review-error"
        />
      )}
      <Checkbox
        isSelected={values.allowStatusUpdates}
        onChange={(allow) => setEdited({ ...values, allowStatusUpdates: allow })}
        isDisabled={saving || !settings}
        data-testid="workspace-settings-allow-status-updates"
      >
        {t.allowStatusUpdatesLabel}
      </Checkbox>
      <Checkbox
        isSelected={values.allowSubmitterRevision}
        onChange={(allow) => setEdited({ ...values, allowSubmitterRevision: allow })}
        isDisabled={saving || !settings}
        data-testid="workspace-settings-allow-submitter-revision"
      >
        {t.allowSubmitterRevisionLabel}
      </Checkbox>
    </FormSettingsDrawers>
  );
}
