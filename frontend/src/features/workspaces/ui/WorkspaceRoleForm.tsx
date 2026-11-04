'use client';

import {
  Button,
  Checkbox,
  CheckboxGroup,
  InlineAlert,
  TextField,
} from '@bcgov/design-system-react-components';
import type { Dictionary } from '@/src/types/dictionary';
import type { WorkspaceRole } from '@/src/types/workspaceRoles';
import { groupRoleLabel } from '../groupRoleLabel';
import { PERMISSION_AREAS, grantsAllPermissions, permissionLabel } from '../rolePermissions';
import { TabFormSection } from './TabForm';
import styles from './WorkspaceForm.module.css';

export interface WorkspaceRoleFormProps {
  dict: Dictionary;
  role: WorkspaceRole;
  onDone: () => void;
}

/** A fixed role, shown for reference under the table. */
export function WorkspaceRoleForm({ dict, role, onDone }: Readonly<WorkspaceRoleFormProps>) {
  const t = dict.workspaces.roles;
  const label = groupRoleLabel(dict, role.roleCode, role.name);
  const allGranted = grantsAllPermissions(role.permissions);

  return (
    <TabFormSection heading={label} testId="workspace-role-view">
      <div className={styles.fieldStack}>
        <InlineAlert
          title={t.fixedRole}
          description={t.fixedRoleHelp}
          variant="info"
          data-testid="fixed-role-alert"
        />
        <TextField label={t.name} value={label} isDisabled data-testid="role-name-input" />
        {PERMISSION_AREAS.map(({ area, codes }) => (
          <CheckboxGroup
            key={area}
            label={t.areas[area]}
            value={allGranted ? codes : role.permissions}
            isDisabled
          >
            {codes.map((code) => (
              <Checkbox key={code} value={code} data-testid={`permission-checkbox-${code}`}>
                {permissionLabel(dict, code)}
              </Checkbox>
            ))}
          </CheckboxGroup>
        ))}
        <div className={styles.actions}>
          <Button variant="secondary" onPress={onDone} data-testid="role-close-button">
            {t.close}
          </Button>
        </div>
      </div>
    </TabFormSection>
  );
}

export default WorkspaceRoleForm;
