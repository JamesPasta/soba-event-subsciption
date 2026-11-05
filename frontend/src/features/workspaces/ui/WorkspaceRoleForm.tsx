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
import type { Dictionary } from '@/src/types/dictionary';
import { WORKSPACE_ROLE_NAME_MAX_LENGTH, type WorkspaceRole } from '@/src/types/workspaceRoles';
import { useWorkspaceRole } from '../data/useWorkspaceRole';
import { useWorkspaceRolesWriter } from '../data/useWorkspaceRolesWriter';
import { groupRoleLabel } from '../groupRoleLabel';
import {
  PERMISSION_AREAS,
  grantsAllPermissions,
  permissionLabel,
  withNeededPermissions,
} from '../rolePermissions';
import { TabFormSection, TabFormUnavailable } from './TabForm';
import styles from './WorkspaceForm.module.css';

export interface WorkspaceRoleFormProps {
  dict: Dictionary;
  workspaceId: string;
  /** The role to show or edit. Left out, the form creates one. */
  roleCode?: string;
  onDone: () => void;
}

/**
 * Create a role, edit one of the workspace's own, or show a fixed one. An existing role is read on
 * its own rather than taken from the list's row, so the fields start from the role as it is now.
 */
export function WorkspaceRoleForm({
  dict,
  workspaceId,
  roleCode,
  onDone,
}: Readonly<WorkspaceRoleFormProps>) {
  const t = dict.workspaces.roles;
  const authDefaults = useAuthErrorDefaults();
  const record = useWorkspaceRole(workspaceId, roleCode ?? null);

  let content: React.ReactNode;
  if (record.error && !record.role) {
    // Editing without the record would post the empty fields as a new role.
    content = (
      <TabFormUnavailable
        message={messageForDataError(record.error, { ...authDefaults, failed: t.roleLoadError })}
        testId="role-load-error"
        cancelLabel={t.cancel}
        cancelTestId="role-cancel-button"
        onCancel={onDone}
      />
    );
  } else if (roleCode && !record.role) {
    // Also covers a read still waiting on the session, which reports no loading of its own.
    content = <CenteredProgress label={dict.general.loading} />;
  } else {
    content = (
      <RoleFields
        key={record.role?.roleCode ?? 'new'}
        dict={dict}
        workspaceId={workspaceId}
        role={record.role}
        onDone={onDone}
      />
    );
  }

  let heading = t.addRole;
  if (record.role) heading = groupRoleLabel(dict, record.role.roleCode, record.role.name);
  else if (roleCode) heading = t.editRole;

  return (
    <TabFormSection
      heading={heading}
      testId={roleCode ? 'workspace-role-edit-form' : 'workspace-role-create-form'}
    >
      {content}
    </TabFormSection>
  );
}

interface RoleFieldsProps {
  dict: Dictionary;
  workspaceId: string;
  /** The role as read for this form, or null to create one. Seeds the fields on mount. */
  role: WorkspaceRole | null;
  onDone: () => void;
}

function RoleFields({ dict, workspaceId, role, onDone }: Readonly<RoleFieldsProps>) {
  const t = dict.workspaces.roles;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const writer = useWorkspaceRolesWriter(workspaceId);

  const isFixed = role?.system === true;
  const [name, setName] = useState(role ? groupRoleLabel(dict, role.roleCode, role.name) : '');
  const [permissionCodes, setPermissionCodes] = useState<string[]>(role?.permissions ?? []);
  const [saving, setSaving] = useState(false);
  const [seed] = useState(role);

  const trimmedName = name.trim();
  const canSave =
    Boolean(token) && trimmedName.length > 0 && permissionCodes.length > 0 && !saving && !isFixed;

  const save = async () => {
    if (!token || !canSave) return;
    setSaving(true);
    try {
      const fields = { name: trimmedName, permissionCodes };
      if (seed) await writer.update(token, seed, fields);
      else await writer.create(token, fields);
      addNotification({ text: role ? t.updateSuccess : t.createSuccess, type: 'success' });
      onDone();
    } catch (err: unknown) {
      // A coded refusal, such as a name already in use, says why; anything else is generic.
      addNotification({
        text: apiErrorMessage(err, dict.apiErrors) ?? (role ? t.updateError : t.createError),
        type: 'error',
        consoleError: err,
      });
    } finally {
      setSaving(false);
    }
  };

  let saveLabel = role ? t.save : t.create;
  if (saving) saveLabel = t.saving;

  const allGranted = grantsAllPermissions(permissionCodes);

  return (
    <Form
      className={styles.fieldStack}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {isFixed && (
        <InlineAlert
          title={t.fixedRole}
          description={t.fixedRoleHelp}
          variant="info"
          data-testid="fixed-role-alert"
        />
      )}
      <TextField
        label={t.name}
        value={name}
        onChange={setName}
        maxLength={WORKSPACE_ROLE_NAME_MAX_LENGTH}
        isRequired
        isDisabled={saving || isFixed}
        data-testid="role-name-input"
      />
      {!isFixed && <p data-testid="role-permissions-help">{t.permissionsHelp}</p>}
      {PERMISSION_AREAS.map(({ area, codes }) => (
        <CheckboxGroup
          key={area}
          label={t.areas[area]}
          value={allGranted ? codes : permissionCodes}
          onChange={(next) => setPermissionCodes((current) => withNeededPermissions(current, next))}
          isDisabled={saving || isFixed}
        >
          {codes.map((code) => (
            <Checkbox key={code} value={code} data-testid={`permission-checkbox-${code}`}>
              {permissionLabel(dict, code)}
            </Checkbox>
          ))}
        </CheckboxGroup>
      ))}
      <div className={styles.actions}>
        {!isFixed && (
          <Button
            type="submit"
            variant="primary"
            isDisabled={!canSave}
            data-testid="role-submit-button"
          >
            {saveLabel}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          isDisabled={saving}
          onPress={onDone}
          data-testid="role-cancel-button"
        >
          {isFixed ? t.close : t.cancel}
        </Button>
      </div>
    </Form>
  );
}

export default WorkspaceRoleForm;
