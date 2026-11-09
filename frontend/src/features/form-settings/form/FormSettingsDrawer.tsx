'use client';

import { useState, useMemo } from 'react';
import { TextArea, TextField } from '@bcgov/design-system-react-components';

import FormSettingsDrawers from '@/src/features/form-settings/ui/FormSettingsDrawers';
import type { FormSettingsSectionProps } from '@/src/features/form-settings/types';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useForm, useFormWriter } from '@/src/features/designer/data/useForm';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';

export default function FormSettingsDrawer({ dict, drawerName, formId }: FormSettingsSectionProps) {
  const { token } = useKeycloak();
  const { form } = useForm(formId);
  const formWriter = useFormWriter(formId);
  const { addNotification } = useNotificationStore();

  // An edit layered over the loaded value. Null means no edit, so a refresh from anywhere shows
  // through until the user types.
  const [editedDescription, setEditedDescription] = useState<string | null>(null);
  const [editedName, setEditedName] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const description = editedDescription ?? form?.description ?? '';
  const formName = editedName ?? form?.name ?? '';

  const edited = useMemo(() => {
    return editedName !== null || editedDescription !== null;
  }, [editedName, editedDescription]);

  const saveChanges = async () => {
    if (token !== undefined) {
      setSaving(true);
      try {
        const payload: { name?: string; description?: string } = {};
        if (editedName !== null) {
          payload.name = editedName.trim();
        }
        if (editedDescription !== null) {
          payload.description = editedDescription;
        }
        if (Object.keys(payload).length === 0) {
          setSaving(false);
          return;
        }
        await formWriter.update(token, payload);
        setEditedDescription(null);
        setEditedName(null);
        addNotification({
          type: 'success',
          text:
            dict.form.settings.formSettingsDrawerSaveSuccessMessage ||
            'Changes saved successfully.',
        });
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
    setEditedDescription(null);
    setEditedName(null);
  };

  return (
    <FormSettingsDrawers
      dict={dict}
      id={drawerName}
      label={dict.form.settings.formSettingsDrawerLabel}
      onSave={saveChanges}
      onCancel={cancelChanges}
      canSave={!saving && edited}
    >
      <TextField
        label={dict.form.nameLabel}
        value={formName}
        isDisabled={saving}
        isRequired
        validate={(value) => (value.trim() ? null : dict.form.noFormName)}
        errorMessage={dict.form.noFormName}
        data-testid="form-settings-name"
        onChange={(newName) => setEditedName(newName)}
      />
      <TextArea
        id="form-settings-description"
        className="bcds-react-aria-TextArea w-100"
        label={dict.form.descriptionLabel}
        value={description}
        isDisabled={saving}
        data-testid="form-settings-description"
        onChange={(newDescription) => setEditedDescription(newDescription)}
      />
    </FormSettingsDrawers>
  );
}
