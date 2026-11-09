'use client';

import { useMemo, useState } from 'react';
import { Button } from '@bcgov/design-system-react-components';
import { ListPageToolbar } from '@/src/components/ListPageLayout';
import { DataTable, type Column } from '@/src/components/DataTable';
import { RowActionButton } from '@/src/components/RowActionButton';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { Tag } from '@/src/components/Tag';
import { ListPageSearchField } from '@/src/components/ListPageSearchField';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { useRolesMeta } from '@/src/shared/api/useRolesMeta';
import { WORKSPACE_GROUPS_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import type { Dictionary } from '@/src/types/dictionary';
import type { WorkspaceGroup } from '@/src/types/workspaceGroups';
import { useWorkspaceGroups } from '../data/useWorkspaceGroups';
import { useWorkspaceGroupsWriter } from '../data/useWorkspaceGroupsWriter';
import { groupRoleLabel } from '../groupRoleLabel';
import WorkspaceGroupForm from './WorkspaceGroupForm';

export interface WorkspaceGroupTabProps {
  dict: Dictionary;
  workspaceId: string;
}

/** What opens under the table: nothing, the create form, or the edit form for one group's id. */
type FormView = null | 'new' | { groupId: string };

export function WorkspaceGroupTab({ dict, workspaceId }: Readonly<WorkspaceGroupTabProps>) {
  const t = dict.workspaces.groups;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();

  const query = useListQuery(WORKSPACE_GROUPS_LIST_QUERY);
  const groupsResult = useWorkspaceGroups(workspaceId, {
    offset: query.offset,
    limit: query.pageSize,
    sort: query.sort,
    q: query.q,
  });
  const { table } = useDataTable(query, groupsResult, t.loadError);
  const writer = useWorkspaceGroupsWriter(workspaceId);
  // Only for the catalog's own role names; a failed read falls back to the dictionary or the code.
  const { data: roles } = useRolesMeta();

  const [formView, setFormView] = useState<FormView>(null);
  const [pendingDelete, setPendingDelete] = useState<WorkspaceGroup | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!token || !pendingDelete) return;
    setIsDeleting(true);
    try {
      await writer.remove(token, pendingDelete.id);
      addNotification({ text: t.deleteSuccess, type: 'success' });
      // Close the edit form only if it was for the group just removed; another open form, such as
      // a half-filled create, is left as it was.
      const removedId = pendingDelete.id;
      setFormView((view) => (view && view !== 'new' && view.groupId === removedId ? null : view));
      setPendingDelete(null);
    } catch (err: unknown) {
      addNotification({ text: t.deleteError, type: 'error', consoleError: err });
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: Column<WorkspaceGroup>[] = useMemo(() => {
    const catalogNames = new Map(roles?.map((role) => [role.roleCode, role.name]));
    return [
      {
        key: 'name',
        label: t.columns.name,
        width: '30%',
        sortField: 'name',
        render: (group) => <span data-testid={`group-name-${group.id}`}>{group.name}</span>,
      },
      {
        key: 'roles',
        label: t.columns.roles,
        width: '30%',
        render: (group) =>
          group.roles.length === 0 ? (
            <span>{t.noRolesSelected}</span>
          ) : (
            group.roles.map((code) => (
              <Tag
                key={code}
                text={groupRoleLabel(dict, code, catalogNames.get(code))}
                color="blue"
                data-testid={`group-role-${group.id}-${code}`}
              />
            ))
          ),
      },
      {
        key: 'actions',
        label: t.columns.actions,
        width: '10%',
        align: 'end',
        render: (group) => (
          <div>
            <RowActionButton
              onPress={() => setFormView({ groupId: group.id })}
              aria-label={`${t.editGroup}: ${group.name}`}
              data-testid={`edit-group-button-${group.id}`}
            >
              {t.editGroup}
            </RowActionButton>
            {!group.system && (
              <RowActionButton
                onPress={() => setPendingDelete(group)}
                aria-label={`${t.deleteGroup}: ${group.name}`}
                data-testid={`delete-group-button-${group.id}`}
              >
                {t.deleteGroup}
              </RowActionButton>
            )}
          </div>
        ),
      },
    ];
  }, [dict, t, roles]);

  const editingId = formView && formView !== 'new' ? formView.groupId : undefined;

  return (
    <div data-testid="workspace-groups-tab-content">
      <ListPageToolbar>
        <ListPageSearchField
          value={query.searchInput}
          onChange={query.setSearchInput}
          onSubmit={query.commitSearch}
          testIdPrefix="ws-groups"
        />
        <Button
          variant="primary"
          data-testid="create-ws-group-button"
          onPress={() => setFormView((view) => (view === 'new' ? null : 'new'))}
        >
          {t.addGroup}
        </Button>
      </ListPageToolbar>

      <DataTable<WorkspaceGroup>
        {...table}
        columns={columns}
        emptyMessage={t.empty}
        loadingMessage={dict.general.loading}
        itemName="items"
        keyExtractor={(item) => item.id}
      />

      {formView && (
        <WorkspaceGroupForm
          key={editingId ?? 'new'}
          dict={dict}
          workspaceId={workspaceId}
          groupId={editingId}
          onDone={() => setFormView(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          show
          title={t.deleteConfirmTitle}
          message={t.deleteConfirmMessage.replace('{name}', () => pendingDelete.name)}
          confirmLabel={t.deleteGroup}
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

export default WorkspaceGroupTab;
