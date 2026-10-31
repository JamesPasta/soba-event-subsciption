'use client';

import { useState } from 'react';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Form,
  InlineAlert,
  TextField,
} from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { apiErrorMessage, messageForDataError } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { useRolesMeta } from '@/src/shared/api/useRolesMeta';
import type { Dictionary } from '@/src/types/dictionary';
import type { RoleWithSourceMeta, WorkspaceGroup } from '@/src/types/workspaceGroups';
import { useWorkspaceGroup } from '../data/useWorkspaceGroup';
import { useWorkspaceGroupsWriter } from '../data/useWorkspaceGroupsWriter';
import { groupRoleLabel } from '../groupRoleLabel';
import { TabFormSection, TabFormUnavailable } from './TabForm';
import styles from './WorkspaceForm.module.css';

export interface WorkspaceGroupFormProps {
  dict: Dictionary;
  workspaceId: string;
  /** The group to edit. Left out, the form creates one. */
  groupId?: string;
  onDone: () => void;
}

/**
 * Create or edit a workspace group. An edit reads the group on its own rather than taking the
 * list's row, so the fields start from the group as it is now.
 */
export function WorkspaceGroupForm({
  dict,
  workspaceId,
  groupId,
  onDone,
}: Readonly<WorkspaceGroupFormProps>) {
  const t = dict.workspaces.groups;
  const authDefaults = useAuthErrorDefaults();
  const roles = useRolesMeta();
  const record = useWorkspaceGroup(workspaceId, groupId ?? null);

  let content: React.ReactNode;
  if (record.error) {
    // Editing without the record would post the empty fields as a new group.
    content = (
      <TabFormUnavailable
        message={messageForDataError(record.error, { ...authDefaults, failed: t.groupLoadError })}
        testId="group-load-error"
        cancelLabel={t.cancel}
        cancelTestId="group-cancel-button"
        onCancel={onDone}
      />
    );
  } else if (roles.error) {
    // Without the role list there is nothing to choose from, and a save would send no roles.
    content = (
      <TabFormUnavailable
        message={messageForDataError(roles.error, { ...authDefaults, failed: t.rolesLoadError })}
        testId="group-roles-error"
        cancelLabel={t.cancel}
        cancelTestId="group-cancel-button"
        onCancel={onDone}
      />
    );
  } else if (!roles.data || (groupId && !record.group)) {
    // Also covers a read still waiting on the session, which reports no loading of its own.
    content = <CenteredProgress label={dict.general.loading} />;
  } else {
    content = (
      <GroupFields
        key={record.group?.id ?? 'new'}
        dict={dict}
        workspaceId={workspaceId}
        group={record.group}
        roles={roles.data}
        onDone={onDone}
      />
    );
  }

  return (
    <TabFormSection
      heading={groupId ? t.editGroup : t.addGroup}
      testId={groupId ? 'workspace-group-edit-form' : 'workspace-group-create-form'}
    >
      {content}
    </TabFormSection>
  );
}

interface GroupFieldsProps {
  dict: Dictionary;
  workspaceId: string;
  /** The group as read for this form, or null to create one. Seeds the fields on mount. */
  group: WorkspaceGroup | null;
  roles: RoleWithSourceMeta[];
  onDone: () => void;
}

function GroupFields({ dict, workspaceId, group, roles, onDone }: Readonly<GroupFieldsProps>) {
  const t = dict.workspaces.groups;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const writer = useWorkspaceGroupsWriter(workspaceId);

  const [name, setName] = useState(group?.name ?? '');
  const [roleCodes, setRoleCodes] = useState<string[]>(group?.roles ?? []);
  const [saving, setSaving] = useState(false);
  const [seed] = useState(group);

  // A system group is protected: shown for reference, with nothing to save.
  const isSystem = group?.system === true;
  const trimmedName = name.trim();
  const canSave = Boolean(token) && trimmedName.length > 0 && !saving && !isSystem;

  const save = async () => {
    if (!token || !canSave) return;
    setSaving(true);
    try {
      const fields = { name: trimmedName, roleCodes };
      if (seed) await writer.update(token, seed, fields);
      else await writer.create(token, fields);
      addNotification({ text: group ? t.updateSuccess : t.createSuccess, type: 'success' });
      onDone();
    } catch (err: unknown) {
      // A coded refusal, such as a name already in use, says why; anything else is generic.
      addNotification({
        text: apiErrorMessage(err, dict.apiErrors) ?? (group ? t.updateError : t.createError),
        type: 'error',
        consoleError: err,
      });
    } finally {
      setSaving(false);
    }
  };

  let saveLabel = group ? t.save : t.create;
  if (saving) saveLabel = t.saving;

  return (
    <Form
      className={styles.fieldStack}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {isSystem && (
        <InlineAlert
          title={t.systemGroup}
          description={t.systemGroupTooltip}
          variant="info"
          data-testid="system-group-alert"
        />
      )}
      <TextField
        label={t.name}
        value={name}
        onChange={setName}
        isRequired
        isDisabled={saving || isSystem}
        data-testid="group-name-input"
      />
      <CheckboxGroup
        label={t.roles}
        description={t.rolesHelp}
        value={roleCodes}
        onChange={setRoleCodes}
        isDisabled={saving || isSystem}
      >
        {roles.map((role) => (
          <Checkbox
            key={role.roleCode}
            value={role.roleCode}
            data-testid={`role-checkbox-${role.roleCode}`}
          >
            {groupRoleLabel(dict, role.roleCode, role.name)}
          </Checkbox>
        ))}
      </CheckboxGroup>
      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          isDisabled={!canSave}
          data-testid="group-submit-button"
        >
          {saveLabel}
        </Button>
        <Button
          type="button"
          variant="secondary"
          isDisabled={saving}
          onPress={onDone}
          data-testid="group-cancel-button"
        >
          {t.cancel}
        </Button>
      </div>
    </Form>
  );
}

export default WorkspaceGroupForm;
