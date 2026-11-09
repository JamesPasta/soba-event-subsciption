'use client';
import { useMemo, useState } from 'react';
import { Button, InlineAlert } from '@bcgov/design-system-react-components';

import type { Dictionary } from '@/src/types/dictionary';
import type { TeamMember } from '@/src/types/formTeam';
import { DataTable, type Column } from '@/src/components/DataTable';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { ListPageSearchField } from '@/src/components/ListPageSearchField';
import { ListPageToolbar } from '@/src/components/ListPageLayout';
import { RowActionButton } from '@/src/components/RowActionButton';
import { Tag } from '@/src/components/Tag';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import {
  useFormTeamMembers,
  useFormTeamWriter,
  useTeamGroups,
} from '@/src/features/designer/data/useFormTeam';
import { useUserSearchAllowed } from '@/src/features/user-search/data/useUserSearch';
import { FORM_TEAM_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import FormTeamMemberForm from './FormTeamMemberForm';

interface FormTeamTabProps {
  dict: Dictionary;
  formId: string;
}

export default function FormTeamTab({ dict, formId }: Readonly<FormTeamTabProps>) {
  const t = dict.team;
  const query = useListQuery(FORM_TEAM_LIST_QUERY);
  const membersResult = useFormTeamMembers(formId, {
    offset: query.offset,
    limit: query.pageSize,
    sort: query.sort,
    q: query.q,
  });
  const { table } = useDataTable(query, membersResult, t.loadError);
  const groups = useTeamGroups();
  const teamWriter = useFormTeamWriter(formId);
  // People are added by finding them with user search.
  const searchAllowed = useUserSearchAllowed();
  const { addNotification } = useNotificationStore();
  // The list, the add form, or the edit form for one member.
  const [view, setView] = useState<'list' | 'add' | TeamMember>('list');
  const [pendingRemove, setPendingRemove] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    setRemoving(true);
    try {
      await teamWriter.remove(pendingRemove.id);
      addNotification({ text: t.removeSuccess, type: 'success' });
    } catch (e: unknown) {
      addNotification({ text: t.removeFailure, type: 'error', consoleError: e });
    } finally {
      setRemoving(false);
      setPendingRemove(null);
    }
  };

  const columns: Column<TeamMember>[] = useMemo(
    () => [
      { key: 'name', label: t.name },
      { key: 'email', label: t.email },
      {
        key: 'groups',
        label: t.groups,
        render: (member) => (
          <span className="d-inline-flex flex-wrap gap-1">
            {groups
              .filter((group) => member.groups.includes(group.id))
              .map((group) => (
                <Tag
                  key={group.id}
                  data-testid={`${member.id}-${group.id}-tag`}
                  text={group.name}
                  color="blue"
                />
              ))}
          </span>
        ),
      },
      {
        key: 'actions',
        label: t.actions,
        render: (member) => (
          <div className="d-flex gap-2 justify-content-start">
            <RowActionButton data-testid={`${member.id}-edit-link`} onPress={() => setView(member)}>
              {t.edit}
            </RowActionButton>
            <RowActionButton
              data-testid={`${member.id}-remove-link`}
              onPress={() => setPendingRemove(member)}
            >
              {t.remove}
            </RowActionButton>
          </div>
        ),
      },
    ],
    [t, groups],
  );

  // Until the team API exists nothing on this tab is saved, so the tab says so.
  const sampleNotice = (
    <div className="mb-3">
      <InlineAlert variant="info" data-testid="team-sample-notice">
        {t.sampleNotice}
      </InlineAlert>
    </div>
  );

  if (view !== 'list') {
    return (
      <>
        {sampleNotice}
        <FormTeamMemberForm
          dict={dict}
          formId={formId}
          member={view === 'add' ? undefined : view}
          onDone={() => setView('list')}
        />
      </>
    );
  }

  return (
    <div data-testid="team-list">
      {sampleNotice}
      <ListPageToolbar align="between">
        <ListPageSearchField
          value={query.searchInput}
          onChange={query.setSearchInput}
          onSubmit={query.commitSearch}
          testIdPrefix="team"
        />
        {searchAllowed && (
          <Button variant="primary" data-testid="team-add-button" onPress={() => setView('add')}>
            {t.addMember}
          </Button>
        )}
      </ListPageToolbar>
      <DataTable<TeamMember>
        {...table}
        columns={columns}
        emptyMessage={t.emptyList}
        loadingMessage={dict.general.loading}
        caption={t.members}
        keyExtractor={(member) => member.id}
      />
      <ConfirmModal
        show={pendingRemove !== null}
        title={t.removeTitle}
        message={pendingRemove ? t.removeMessage.replace('{name}', pendingRemove.name) : ''}
        confirmLabel={t.remove}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingRemove(null)}
        pending={removing}
      />
    </div>
  );
}
