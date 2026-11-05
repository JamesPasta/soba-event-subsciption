'use client';

import { useMemo, useState } from 'react';
import { Button } from '@bcgov/design-system-react-components';
import { matchesSearchTerm } from '@soba/lib/sort';
import { ListPageToolbar } from '@/src/components/ListPageLayout';
import { DataTable, type Column } from '@/src/components/DataTable';
import { RowActionButton } from '@/src/components/RowActionButton';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { Tag } from '@/src/components/Tag';
import { ListPageSearchField } from '@/src/components/ListPageSearchField';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { apiErrorMessage } from '@/src/shared/api/dataError';
import { WORKSPACE_ROLES_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import type { Dictionary } from '@/src/types/dictionary';
import type { WorkspaceRole } from '@/src/types/workspaceRoles';
import { useWorkspaceRoles } from '../data/useWorkspaceRoles';
import { useWorkspaceRolesWriter } from '../data/useWorkspaceRolesWriter';
import { groupRoleLabel, rolesByLabel } from '../groupRoleLabel';
import { grantsAllPermissions } from '../rolePermissions';
import WorkspaceRoleForm from './WorkspaceRoleForm';

export interface WorkspaceRoleTabProps {
  dict: Dictionary;
  workspaceId: string;
}

/** What opens under the table: nothing, the create form, or the form for one role's code. */
type FormView = null | 'new' | { roleCode: string };

const permissionSummary = (
  t: Dictionary['workspaces']['roles'],
  permissions: readonly string[],
): string => {
  if (grantsAllPermissions(permissions)) return t.allPermissions;
  if (permissions.length === 1) return t.permissionCountOne;
  return t.permissionCount.replace('{count}', String(permissions.length));
};

export function WorkspaceRoleTab({ dict, workspaceId }: Readonly<WorkspaceRoleTabProps>) {
  const t = dict.workspaces.roles;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const locale = useSortLocale();
  const query = useListQuery(WORKSPACE_ROLES_LIST_QUERY);
  const rolesResult = useWorkspaceRoles(workspaceId);
  const { rows, total } = rolesResult;
  const writer = useWorkspaceRolesWriter(workspaceId);

  const [formView, setFormView] = useState<FormView>(null);
  const [pendingDelete, setPendingDelete] = useState<WorkspaceRole | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Searched and ordered here: fixed roles show dictionary names the server does not have.
  const matching = useMemo(() => {
    const direction = query.sort.endsWith(':desc') ? 'desc' : 'asc';
    return rolesByLabel(dict, rows, locale, direction).filter((role) =>
      matchesSearchTerm(groupRoleLabel(dict, role.roleCode, role.name), query.q),
    );
  }, [dict, rows, query.q, query.sort, locale]);

  const { table } = useDataTable(
    query,
    {
      ...rolesResult,
      rows: matching.slice(query.offset, query.offset + query.pageSize),
      total: total === undefined ? undefined : matching.length,
    },
    t.loadError,
  );

  const confirmDelete = async () => {
    if (!token || !pendingDelete) return;
    setIsDeleting(true);
    try {
      await writer.remove(token, pendingDelete.roleCode);
      addNotification({ text: t.deleteSuccess, type: 'success' });
      // Close the form only if it was for the role just removed; another open form, such as a
      // half-filled create, is left as it was.
      const removedCode = pendingDelete.roleCode;
      setFormView((view) =>
        view && view !== 'new' && view.roleCode === removedCode ? null : view,
      );
      setPendingDelete(null);
    } catch (err: unknown) {
      // A role still on a group is refused with a code, which says what to do about it.
      addNotification({
        text: apiErrorMessage(err, dict.apiErrors) ?? t.deleteError,
        type: 'error',
        consoleError: err,
      });
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: Column<WorkspaceRole>[] = useMemo(() => {
    const rowAction = (
      role: WorkspaceRole,
      action: { label: string; testId: string; onPress: () => void },
    ) => (
      <RowActionButton
        onPress={action.onPress}
        aria-label={`${action.label}: ${groupRoleLabel(dict, role.roleCode, role.name)}`}
        data-testid={`${action.testId}-${role.roleCode}`}
      >
        {action.label}
      </RowActionButton>
    );
    return [
      {
        key: 'name',
        label: t.columns.name,
        width: '40%',
        sortField: 'name',
        render: (role) => (
          <span data-testid={`role-name-${role.roleCode}`}>
            {groupRoleLabel(dict, role.roleCode, role.name)}
          </span>
        ),
      },
      {
        key: 'type',
        label: t.columns.type,
        render: (role) => (
          <Tag
            text={role.system ? t.types.fixed : t.types.custom}
            color={role.system ? 'grey' : 'blue'}
            data-testid={`role-type-${role.roleCode}`}
          />
        ),
      },
      {
        key: 'permissions',
        label: t.columns.permissions,
        render: (role) => (
          <span data-testid={`role-permissions-${role.roleCode}`}>
            {permissionSummary(t, role.permissions)}
          </span>
        ),
      },
      {
        key: 'actions',
        label: t.columns.actions,
        width: '10%',
        align: 'end',
        render: (role) => {
          const open = () => setFormView({ roleCode: role.roleCode });
          if (role.system) {
            return rowAction(role, {
              label: t.viewRole,
              testId: 'view-role-button',
              onPress: open,
            });
          }
          return (
            <div>
              {rowAction(role, { label: t.editRole, testId: 'edit-role-button', onPress: open })}
              {rowAction(role, {
                label: t.deleteRole,
                testId: 'delete-role-button',
                onPress: () => setPendingDelete(role),
              })}
            </div>
          );
        },
      },
    ];
  }, [dict, t]);

  const openCode = formView && formView !== 'new' ? formView.roleCode : undefined;

  return (
    <div data-testid="workspace-roles-tab-content">
      <ListPageToolbar>
        <ListPageSearchField
          value={query.searchInput}
          onChange={query.setSearchInput}
          onSubmit={query.commitSearch}
          testIdPrefix="ws-roles"
        />
        <Button
          variant="primary"
          data-testid="create-ws-role-button"
          onPress={() => setFormView((view) => (view === 'new' ? null : 'new'))}
        >
          {t.addRole}
        </Button>
      </ListPageToolbar>

      <DataTable<WorkspaceRole>
        {...table}
        columns={columns}
        emptyMessage={t.empty}
        loadingMessage={dict.general.loading}
        itemName="items"
        keyExtractor={(role) => role.roleCode}
      />

      {formView && (
        <WorkspaceRoleForm
          key={openCode ?? 'new'}
          dict={dict}
          workspaceId={workspaceId}
          roleCode={openCode}
          onDone={() => setFormView(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          show
          title={t.deleteConfirmTitle}
          message={t.deleteConfirmMessage.replace('{name}', () => pendingDelete.name)}
          confirmLabel={t.deleteRole}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            if (!isDeleting) setPendingDelete(null);
          }}
          pending={isDeleting}
        />
      )}
    </div>
  );
}

export default WorkspaceRoleTab;
