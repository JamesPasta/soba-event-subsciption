'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { Form, TextField, Button, InlineAlert } from '@bcgov/design-system-react-components';
import { WorkspaceSelector } from '@/app/ui/WorkspaceSelector';
import { useDictionary } from '@/app/[lang]/Providers';
import { useFormCreateWorkspaceOptions } from '@/src/shared/api/useWorkspaces';
import { lookupTruncatedNote } from '@/src/shared/list/lookupOptions';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { useFormCreator } from '@/src/features/designer/data/useForm';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useCurrentUser } from '@/src/shared/api/useCurrentUser';
import { isConflict } from '@/src/shared/api/sobaHelpers';
import { messageForDataError } from '@/src/shared/api/dataError';
import type { CreateFormFields } from '@/src/types/forms';
import { AUDIENCE_SETTINGS_KEY, type Audience } from '@/src/types/formSettings';
import { useFreshWorkspaceSettings } from '@/src/features/form-settings/data/useWorkspaceSettings';
import { useLoginProviders } from '@/src/shared/api/useLoginProviders';
import { useInheritableEdit } from '@/src/features/form-settings/ui/useInheritableEdit';
import InheritCheckbox from '@/src/features/form-settings/ui/InheritCheckbox';
import AudienceField, {
  isValidAudience,
  toAudience,
  type AudienceValue,
} from '@/src/features/form-settings/audience/AudienceField';

interface FormCreateContentProps {
  onCancelPress: () => void;
}

export const FormCreateContent = ({ onCancelPress }: Readonly<FormCreateContentProps>) => {
  const dict = useDictionary();
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const { data: currentUser, loaded: currentUserLoaded } = useCurrentUser();
  const formCreator = useFormCreator();
  const router = useRouter();
  const params = useParams();
  const lang = params.lang as string;

  const formCreate = currentUser?.capabilities?.formCreate;

  const [formName, setFormName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const creatableWorkspaces = useFormCreateWorkspaceOptions(true);

  // The new form inherits the selected workspace's audience unless the creator sets its own. Own
  // values start as a copy of the workspace's, so the read is a fresh one.
  const { settings: workspaceAudience, error: workspaceAudienceError } =
    useFreshWorkspaceSettings<Audience>(AUDIENCE_SETTINGS_KEY, selectedWorkspaceId);
  const { data: providers, error: providersError } = useLoginProviders();
  const audienceReadError = workspaceAudienceError ?? providersError;
  const audienceReadErrorMessage = audienceReadError
    ? messageForDataError(audienceReadError, {
        sessionExpired: dict.general.sessionExpired,
        forbidden: dict.general.noAccess,
        failed: dict.form.settings.audienceLoadError,
      })
    : null;
  const audienceView = useMemo(
    () =>
      workspaceAudience
        ? {
            inherit: true,
            own: null,
            workspace: workspaceAudience.values,
            effective: workspaceAudience.values,
            version: workspaceAudience.version,
          }
        : undefined,
    [workspaceAudience],
  );
  const audienceEdit = useInheritableEdit<AudienceValue>(audienceView);
  const offered = providers ?? [];
  const audienceBody = audienceEdit.body();
  const ownAudience = audienceBody?.inherit === false ? audienceBody.values : null;
  const audienceValid = !ownAudience || isValidAudience(ownAudience, offered);
  // A form is not created against an audience the creator has not been shown.
  const audienceShown = !selectedWorkspaceId || (!!audienceView && !!providers);

  const saveForm = async () => {
    if (isSaving) return;
    // Creating a form is workspace-scoped: without a selected workspace the backend
    // rejects the request with a generic error, so surface a clear message instead.
    if (!selectedWorkspaceId) {
      addNotification({ text: dict.form.noActiveWorkspaceError, type: 'error' });
      return;
    }
    setIsSaving(true);

    try {
      const data: CreateFormFields = { name: formName.trim() };
      if (ownAudience) {
        data.settings = {
          audience: { inherit: false, values: toAudience(ownAudience, offered) },
        };
      }
      const outcome = await formCreator.create(
        token as string,
        data,
        selectedWorkspaceId || undefined,
      );

      addNotification({
        text: dict.form.saved,
        type: 'success',
      });
      if (outcome.status === 'applied') {
        router.push(`/${lang}/build/${outcome.value.id}`);
      }
    } catch (e: unknown) {
      // A 409 carries the backend's own reason: the name is taken, or the workspace disclaimer is
      // unaccepted. Nothing in this dialog has versions, so the version-conflict wording is wrong.
      const conflict = isConflict(e) && e instanceof Error && e.message;
      addNotification({
        text: conflict ? e.message : dict.form.saveError,
        type: 'error',
        consoleError: e,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // New-form mode requires a workspace to own the form. When none qualifies, block designer access
  // with a clear prompt instead of a save failure. Having the permission but no accepted disclaimer
  // is actionable, so it gets its own message.
  if (currentUserLoaded && formCreate !== 'allowed') {
    const blocked =
      formCreate === 'disclaimer_required'
        ? {
            variant: 'warning' as const,
            testId: 'disclaimer-required-alert',
            text: dict.form.disclaimerRequired,
          }
        : {
            variant: 'info' as const,
            testId: 'designer-select-workspace',
            text: dict.form.noActiveWorkspace,
          };
    return (
      <div className="p-4">
        <InlineAlert variant={blocked.variant} data-testid={blocked.testId}>
          {blocked.text}
        </InlineAlert>
      </div>
    );
  }

  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        void saveForm();
      }}
      className="d-flex flex-column gap-3 mb-3"
      style={{ maxWidth: '640px' }}
    >
      <TextField
        label={dict.form.nameLabel}
        value={formName}
        onChange={setFormName}
        isRequired={true}
        validate={(value) => (value.trim() ? null : dict.form.noFormName)}
        errorMessage={dict.form.noFormName}
        data-testid="form-name-modal"
      />

      {creatableWorkspaces.workspaces.length > 0 && (
        <WorkspaceSelector
          label={dict.workspaces.workspace}
          workspaces={creatableWorkspaces.workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          isRequired={true}
          onChange={(id) => {
            setSelectedWorkspaceId(id as string);
            audienceEdit.reset();
          }}
          description={lookupTruncatedNote(dict.general.lookupTruncated, creatableWorkspaces)}
          size="medium"
        />
      )}

      {selectedWorkspaceId && (
        <div className="p-3 border rounded-3 bg-light" data-testid="create-form-audience">
          {audienceReadErrorMessage && (
            <div className="mb-3">
              <InlineAlert
                variant="warning"
                title={audienceReadErrorMessage}
                data-testid="create-form-audience-error"
              />
            </div>
          )}
          <InheritCheckbox
            label={dict.form.settings.inheritWorkspaceLabel}
            isSelected={audienceEdit.inherit}
            onChange={audienceEdit.setInherit}
            isDisabled={isSaving || !audienceShown}
            testId="create-form-audience-inherit"
          />
          {audienceEdit.values && providers && (
            <AudienceField
              dict={dict}
              value={audienceEdit.values}
              onChange={audienceEdit.setValues}
              providers={offered}
              isDisabled={isSaving || audienceEdit.inherit}
            />
          )}
        </div>
      )}

      <div className="d-flex justify-content-end gap-2">
        <Button
          type="button"
          isDisabled={isSaving}
          variant="secondary"
          onPress={onCancelPress}
          data-testid="cancel-create-form"
        >
          {dict.general.cancel}
        </Button>
        <Button
          type="submit"
          isDisabled={isSaving || !audienceValid || !audienceShown}
          data-testid="save-create-form"
        >
          {dict.general.next}
        </Button>
      </div>
    </Form>
  );
};
