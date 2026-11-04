'use client';

import { useMemo, useState } from 'react';
import { compareTextForSort, matchesSearchTerm } from '@soba/lib/sort';
import { ListPageToolbar } from '@/src/components/ListPageLayout';
import { DataTable, type Column } from '@/src/components/DataTable';
import { RowActionButton } from '@/src/components/RowActionButton';
import { Tag } from '@/src/components/Tag';
import { ListPageSearchField } from '@/src/components/ListPageSearchField';
import { WORKSPACE_ROLES_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import type { Dictionary } from '@/src/types/dictionary';
import type { WorkspaceRole } from '@/src/types/workspaceRoles';
import { useWorkspaceRoles } from '../data/useWorkspaceRoles';
import { groupRoleLabel } from '../groupRoleLabel';
import { grantsAllPermissions } from '../rolePermissions';
import WorkspaceRoleForm from './WorkspaceRoleForm';

export interface WorkspaceRoleTabProps {
  dict: Dictionary;
  workspaceId: string;
}

export function WorkspaceRoleTab({ dict, workspaceId }: Readonly<WorkspaceRoleTabProps>) {
  const t = dict.workspaces.roles;
  const locale = useSortLocale();
  const query = useListQuery(WORKSPACE_ROLES_LIST_QUERY);
  const rolesResult = useWorkspaceRoles(workspaceId);
  const { rows, total } = rolesResult;

  const [viewingCode, setViewingCode] = useState<string | null>(null);

  // Searched and ordered here: fixed roles show dictionary names the server does not have.
  const matching = useMemo(() => {
    const labelled = rows.map((role) => ({
      role,
      label: groupRoleLabel(dict, role.roleCode, role.name),
    }));
    const direction = query.sort.endsWith(':desc') ? 'desc' : 'asc';
    return labelled
      .filter(({ label }) => matchesSearchTerm(label, query.q))
      .sort((a, b) => compareTextForSort(a.label, b.label, direction, locale, { linguistic: true }))
      .map(({ role }) => role);
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

  const columns: Column<WorkspaceRole>[] = useMemo(
    () => [
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
        render: (role) => (
          <RowActionButton
            onPress={() => setViewingCode(role.roleCode)}
            aria-label={`${t.viewRole}: ${groupRoleLabel(dict, role.roleCode, role.name)}`}
            data-testid={`view-role-button-${role.roleCode}`}
          >
            {t.viewRole}
          </RowActionButton>
        ),
      },
    ],
    [dict, t],
  );

  const viewing = rows.find((role) => role.roleCode === viewingCode);

  return (
    <div data-testid="workspace-roles-tab-content">
      <ListPageToolbar>
        <ListPageSearchField
          value={query.searchInput}
          onChange={query.setSearchInput}
          onSubmit={query.commitSearch}
          testIdPrefix="ws-roles"
        />
      </ListPageToolbar>

      <DataTable<WorkspaceRole>
        {...table}
        columns={columns}
        emptyMessage={t.empty}
        loadingMessage={dict.general.loading}
        itemName="items"
        keyExtractor={(role) => role.roleCode}
      />

      {viewing && (
        <WorkspaceRoleForm
          key={viewing.roleCode}
          dict={dict}
          role={viewing}
          onDone={() => setViewingCode(null)}
        />
      )}
    </div>
  );
}

const permissionSummary = (
  t: Dictionary['workspaces']['roles'],
  permissions: readonly string[],
): string => {
  if (grantsAllPermissions(permissions)) return t.allPermissions;
  if (permissions.length === 1) return t.permissionCountOne;
  return t.permissionCount.replace('{count}', String(permissions.length));
};

export default WorkspaceRoleTab;
