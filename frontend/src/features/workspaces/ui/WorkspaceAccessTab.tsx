'use client';

import { useEffect, useMemo, useState, type Key } from 'react';
import { Button, Select } from '@bcgov/design-system-react-components';
import { ListPageFilters, ListPageToolbar } from '@/src/components/ListPageLayout';
import { DataTable, type Column } from '@/src/components/DataTable';
import { RowActionButton } from '@/src/components/RowActionButton';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { Tag } from '@/src/components/Tag';
import { ListPageSearchField } from '@/src/components/ListPageSearchField';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { apiErrorMessage } from '@/src/shared/api/dataError';
import { useCurrentUser } from '@/src/shared/api/useCurrentUser';
import { useUserSearchAllowed } from '@/src/features/user-search/data/useUserSearch';
import { WORKSPACE_ACCESS_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import type { Dictionary } from '@/src/types/dictionary';
import type { WorkspaceAccessInclude, WorkspaceAccessMember } from '@/src/types/workspaceAccess';
import { useWorkspaceAccess } from '../data/useWorkspaceAccess';
import { useWorkspaceAccessWriter } from '../data/useWorkspaceAccessWriter';
import { isWorkspaceOwnerRole } from '../workspaceRoles';
import { WorkspaceRoleBadge } from './WorkspaceRoleBadge';
import WorkspaceAccessForm from './WorkspaceAccessForm';
import styles from './WorkspaceForm.module.css';

export interface WorkspaceAccessTabProps {
  dict: Dictionary;
  workspaceId: string;
}

/** What opens under the table: nothing, the add form, or the edit form for one membership's id. */
type FormView = null | 'add' | { membershipId: string };

const ALL: WorkspaceAccessInclude = 'all';
const GROUPED: WorkspaceAccessInclude = 'grouped';

/** What an empty table says: a search, the grouped view, or the whole workspace found no one. */
function emptyMessage(t: Dictionary['workspaces']['access'], q: string, include: string): string {
  if (include === GROUPED) return q ? t.noMatchesGrouped : t.emptyGrouped;
  return q ? t.noMatches : t.empty;
}

/** The remove prompt, naming the workspace role the person also loses when it is more than viewer. */
function removeMessage(
  t: Dictionary['workspaces']['access'],
  member: WorkspaceAccessMember,
): string {
  const role = (t.roleNames as Record<string, string | undefined>)[member.role];
  const template = role ? t.removeConfirmRoleMessage : t.removeConfirmMessage;
  return template
    .replace('{name}', () => member.displayLabel ?? t.unnamed)
    .replace('{role}', () => role ?? '');
}

export function WorkspaceAccessTab({ dict, workspaceId }: Readonly<WorkspaceAccessTabProps>) {
  const t = dict.workspaces.access;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const { data: currentUser } = useCurrentUser();
  const searchAllowed = useUserSearchAllowed();

  const query = useListQuery(WORKSPACE_ACCESS_LIST_QUERY);
  const rawInclude = query.filters.include;
  const include = rawInclude === ALL ? ALL : GROUPED;
  const accessResult = useWorkspaceAccess(workspaceId, {
    offset: query.offset,
    limit: query.pageSize,
    sort: query.sort,
    q: query.q,
    include,
  });
  const { table } = useDataTable(query, accessResult, t.loadError);
  const writer = useWorkspaceAccessWriter(workspaceId);

  const { setFilters } = query;
  // A value the Select does not offer reads as the default; drop it so the URL and the Select agree.
  useEffect(() => {
    if (rawInclude && rawInclude !== ALL) setFilters({});
  }, [rawInclude, setFilters]);

  const [formView, setFormView] = useState<FormView>(null);
  const [pendingRemove, setPendingRemove] = useState<WorkspaceAccessMember | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const confirmRemove = async () => {
    if (!token || !pendingRemove) return;
    setIsRemoving(true);
    try {
      await writer.remove(token, pendingRemove.membershipId);
      addNotification({ text: t.removeSuccess, type: 'success' });
      // Close the edit form only if it was for the person just removed; another open form, such as
      // a half-filled add, is left as it was.
      const removedId = pendingRemove.membershipId;
      setFormView((view) =>
        view && view !== 'add' && view.membershipId === removedId ? null : view,
      );
      setPendingRemove(null);
    } catch (err: unknown) {
      addNotification({
        text: apiErrorMessage(err, dict.apiErrors) ?? t.removeError,
        type: 'error',
        consoleError: err,
      });
    } finally {
      setIsRemoving(false);
    }
  };

  const includeOptions = useMemo(
    () => [
      { id: GROUPED, label: t.showGrouped },
      { id: ALL, label: t.showAll },
    ],
    [t],
  );

  const actorId = currentUser?.actor?.id;
  const columns: Column<WorkspaceAccessMember>[] = useMemo(
    () => [
      {
        key: 'name',
        label: t.columns.name,
        width: '25%',
        sortField: 'displayLabel',
        render: (member) => (
          <span data-testid={`member-name-${member.membershipId}`}>
            {member.displayLabel ?? t.unnamed}
          </span>
        ),
      },
      {
        key: 'email',
        label: t.columns.email,
        width: '25%',
        render: (member) => member.email ?? '',
      },
      {
        key: 'role',
        label: t.columns.role,
        render: (member) => (
          <WorkspaceRoleBadge
            role={member.role}
            data-testid={`member-role-${member.membershipId}`}
          />
        ),
      },
      {
        key: 'groups',
        label: t.columns.groups,
        width: '25%',
        render: (member) =>
          member.groups.length === 0 ? (
            <span>{t.noGroups}</span>
          ) : (
            member.groups.map((group) => (
              <Tag
                key={group.id}
                text={group.name}
                color="blue"
                data-testid={`member-group-${member.membershipId}-${group.id}`}
              />
            ))
          ),
      },
      {
        key: 'actions',
        label: t.columns.actions,
        width: '10%',
        align: 'end',
        render: (member) => {
          const name = member.displayLabel ?? t.unnamed;
          // The API refuses the owner and the caller, who is unknown until the profile loads.
          const protectedMember =
            isWorkspaceOwnerRole(member.role) || !actorId || member.userId === actorId;
          return (
            <div>
              <RowActionButton
                onPress={() => setFormView({ membershipId: member.membershipId })}
                aria-label={`${t.editMember}: ${name}`}
                data-testid={`edit-member-button-${member.membershipId}`}
              >
                {t.editMember}
              </RowActionButton>
              {!protectedMember && (
                <RowActionButton
                  onPress={() => setPendingRemove(member)}
                  aria-label={`${t.removeMember}: ${name}`}
                  data-testid={`remove-member-button-${member.membershipId}`}
                >
                  {t.removeMember}
                </RowActionButton>
              )}
            </div>
          );
        },
      },
    ],
    [t, actorId],
  );

  const editingId = formView && formView !== 'add' ? formView.membershipId : undefined;

  return (
    <div data-testid="workspace-access-tab-content">
      <ListPageToolbar>
        <ListPageSearchField
          value={query.searchInput}
          onChange={query.setSearchInput}
          onSubmit={query.commitSearch}
          testIdPrefix="ws-access"
        />
        {searchAllowed && (
          <Button
            variant="primary"
            data-testid="add-ws-member-button"
            onPress={() => setFormView((view) => (view === 'add' ? null : 'add'))}
          >
            {t.addMember}
          </Button>
        )}
      </ListPageToolbar>

      <ListPageFilters>
        {/* The design system replaces its own root class when given one, so the width sits
            on a wrapper. */}
        <div className={styles.filterField}>
          <Select
            size="medium"
            label={t.show}
            items={includeOptions}
            selectedKey={include}
            onSelectionChange={(key: Key | null) => setFilters(key === ALL ? { include: ALL } : {})}
            data-testid="ws-access-include-filter"
          />
        </div>
      </ListPageFilters>

      <DataTable<WorkspaceAccessMember>
        {...table}
        columns={columns}
        emptyMessage={emptyMessage(t, query.q, include)}
        loadingMessage={dict.general.loading}
        itemName="items"
        keyExtractor={(member) => member.membershipId}
      />

      {formView && (
        <WorkspaceAccessForm
          key={editingId ?? 'add'}
          dict={dict}
          workspaceId={workspaceId}
          membershipId={editingId}
          onDone={() => setFormView(null)}
        />
      )}

      {pendingRemove && (
        <ConfirmModal
          show
          title={t.removeConfirmTitle}
          message={removeMessage(t, pendingRemove)}
          confirmLabel={t.removeMember}
          onConfirm={() => void confirmRemove()}
          onCancel={() => {
            if (!isRemoving) setPendingRemove(null);
          }}
          pending={isRemoving}
        />
      )}
    </div>
  );
}

export default WorkspaceAccessTab;
