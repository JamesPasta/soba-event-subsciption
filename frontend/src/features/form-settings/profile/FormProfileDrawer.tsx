'use client';

import { useState } from 'react';
import { Select } from '@bcgov/design-system-react-components';

import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import type { FormSettingsSectionProps } from '@/src/features/form-settings/types';
import { codeItems } from '@/src/shared/util/codeList';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useForm, useFormWriter } from '@/src/features/designer/data/useForm';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';

export default function FormProfileDrawer({ dict, drawerName, formId }: FormSettingsSectionProps) {
  const { token } = useKeycloak();
  const { form } = useForm(formId);
  const formWriter = useFormWriter(formId);
  const { addNotification } = useNotificationStore();
  const sortLocale = useSortLocale();

  // Edits layered over the loaded values. Null means no edit, so a refresh from anywhere shows
  // through until the user picks something.
  const [editedOrg, setEditedOrg] = useState<string | null>(null);
  const [editedUseCase, setEditedUseCase] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ministryOrg = editedOrg ?? form?.org ?? '';
  const useCase = editedUseCase ?? form?.useCase ?? '';

  const saveChanges = async () => {
    if (token !== undefined) {
      setSaving(true);
      try {
        await formWriter.update(token, {
          org: ministryOrg,
          useCase: useCase,
        });
        addNotification({
          type: 'success',
          text:
            dict.form.settings.formSettingsDrawerSaveSuccessMessage ||
            'Changes saved successfully.',
        });
        setEditedOrg(null);
        setEditedUseCase(null);
      } catch {
        addNotification({
          type: 'error',
          text:
            dict.form.settings.formSettingsDrawerSaveErrorMessage ||
            'Failed to save changes. Please try again.',
        });
      }
      setSaving(false);
    }
  };

  const cancelChanges = () => {
    setEditedOrg(null);
    setEditedUseCase(null);
  };

  return (
    <FormSettingsDrawers
      dict={dict}
      id={drawerName}
      label={dict.form.settings.profileDrawerLabel}
      onSave={saveChanges}
      onCancel={cancelChanges}
      canSave={!saving}
    >
      <p>{dict.form.settings.profileDrawerInfo}</p>
      {/* A Select's native control is visually hidden, so both carry their own error message. */}
      <Select
        items={codeItems(dict.ministries, form?.org, sortLocale)}
        label={dict.workspaces.yourOrgReq}
        selectionMode="single"
        size="medium"
        data-testid="form-profile-org"
        isRequired={true}
        // The native control behind a Select is visually hidden, so a native validation message
        // would point at nothing. This renders under the visible field instead.
        errorMessage={dict.general.fieldRequired}
        isDisabled={saving}
        value={ministryOrg}
        onChange={(newOrg) => setEditedOrg(newOrg?.toString() ?? '')}
      />
      <Select
        items={codeItems(dict.useCases, form?.useCase, sortLocale)}
        label={dict.workspaces.useCase}
        selectionMode="single"
        size="medium"
        data-testid="form-profile-use-case"
        isRequired={true}
        errorMessage={dict.general.fieldRequired}
        isDisabled={saving}
        value={useCase}
        onChange={(newUseCase) => setEditedUseCase(newUseCase?.toString() ?? '')}
      />
    </FormSettingsDrawers>
  );
}
