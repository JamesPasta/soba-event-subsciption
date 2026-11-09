'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button, Form, TextField } from '@bcgov/design-system-react-components';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { DataTable, type Column } from '@/src/components/DataTable';
import { ListPageSearchField } from '@/src/components/ListPageSearchField';
import { ListPageToolbar } from '@/src/components/ListPageLayout';
import { RowActionButton } from '@/src/components/RowActionButton';
import { SecondaryText } from '@/src/components/SecondaryText';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useDictionary } from '@/app/[lang]/Providers';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { useCurrentUser, useRefreshCurrentUser } from '@/src/shared/api/useCurrentUser';
import { useSobaAdmins, useSobaAdminWriter } from '../data/useAdminData';
import { SOBA_ADMINS_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import type { SobaAdminItem } from '@/src/types/admin';
import styles from './AdminPanel.module.css';

/** Admins granted by the IdP are re-synced on every request, so they can't be removed here. */
const SOURCE_IDP = 'idp';

export function SobaAdminsPanel() {
  const dict = useDictionary();
  const dictAdmin = dict.admin;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const { data: currentUser } = useCurrentUser();
  const refreshCurrentUser = useRefreshCurrentUser();

  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<SobaAdminItem | null>(null);

  const query = useListQuery(SOBA_ADMINS_LIST_QUERY);
  const admins = useSobaAdmins({
    offset: query.offset,
    limit: query.pageSize,
    sort: query.sort,
    q: query.q,
  });
  const { table } = useDataTable(query, admins, dictAdmin.admins.loadError);
  const adminWriter = useSobaAdminWriter();

  const handleAdd = useCallback(async () => {
    const trimmed = userId.trim();
    if (!token || !trimmed) return;
    setSaving(true);
    try {
      await adminWriter.add(token, trimmed);
      setUserId('');
      addNotification({ text: dictAdmin.admins.addSuccess, type: 'success' });
    } catch (cause) {
      addNotification({ text: dictAdmin.admins.addError, type: 'error', consoleError: cause });
    } finally {
      setSaving(false);
    }
  }, [
    token,
    userId,
    adminWriter,
    addNotification,
    dictAdmin.admins.addSuccess,
    dictAdmin.admins.addError,
  ]);

  const handleRemove = useCallback(() => {
    const admin = confirmRemove;
    if (!token || !admin) return;
    setSaving(true);
    adminWriter
      .remove(token, admin.userId)
      .then(() => {
        // Removing your own grant ends your access to this console. `/me` is read once per page
        // load, so without this the console stays on screen while every control in it is refused.
        if (admin.userId === currentUser?.actor?.id) void refreshCurrentUser();
        addNotification({ text: dictAdmin.admins.removeSuccess, type: 'success' });
      })
      .catch((cause: unknown) => {
        addNotification({
          text: dictAdmin.admins.removeError,
          type: 'error',
          consoleError: cause,
        });
      })
      .finally(() => {
        setSaving(false);
        setConfirmRemove(null);
      });
  }, [
    token,
    confirmRemove,
    adminWriter,
    currentUser,
    refreshCurrentUser,
    addNotification,
    dictAdmin.admins.removeSuccess,
    dictAdmin.admins.removeError,
  ]);

  const columns: Column<SobaAdminItem>[] = useMemo(
    () => [
      {
        key: 'displayLabel',
        label: dictAdmin.admins.columns.user,
        sortField: 'displayLabel',
        width: '40%',
        render: (admin) => (
          <span className="d-inline-flex flex-column">
            <span>{admin.displayLabel ?? dictAdmin.admins.unknownUser}</span>
            <SecondaryText>{admin.userId}</SecondaryText>
          </span>
        ),
      },
      {
        key: 'source',
        label: dictAdmin.admins.columns.source,
        sortField: 'source',
        render: (admin) => admin.source,
      },
      {
        key: 'identityProviderCode',
        label: dictAdmin.admins.columns.identityProvider,
        render: (admin) => admin.identityProviderCode ?? '—',
      },
      {
        key: 'actions',
        label: dictAdmin.admins.columns.actions,
        render: (admin) =>
          admin.source === SOURCE_IDP ? (
            <SecondaryText>{dictAdmin.admins.idpManaged}</SecondaryText>
          ) : (
            <RowActionButton
              data-testid={`remove-admin-${admin.userId}`}
              onPress={() => setConfirmRemove(admin)}
            >
              {dictAdmin.admins.remove}
            </RowActionButton>
          ),
      },
    ],
    [dictAdmin.admins],
  );

  return (
    <div className={styles.tabContent}>
      <p className={styles.panelIntro}>{dictAdmin.admins.intro}</p>
      <ListPageToolbar align="between">
        <ListPageSearchField
          value={query.searchInput}
          onChange={query.setSearchInput}
          onSubmit={query.commitSearch}
          testIdPrefix="admins"
        />
        <Form
          className="d-flex align-items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            handleAdd().catch(() => undefined);
          }}
        >
          <TextField
            label={dictAdmin.admins.userIdLabel}
            value={userId}
            onChange={setUserId}
            isDisabled={saving}
            data-testid="admin-user-id"
          />
          <Button
            type="submit"
            variant="primary"
            isDisabled={saving || userId.trim() === ''}
            data-testid="add-admin-button"
          >
            {dictAdmin.admins.add}
          </Button>
        </Form>
      </ListPageToolbar>

      <DataTable<SobaAdminItem>
        {...table}
        columns={columns}
        emptyMessage={dictAdmin.admins.empty}
        loadingMessage={dict.general.loading}
        caption={dictAdmin.admins.heading}
        keyExtractor={(admin) => admin.userId}
      />

      <ConfirmModal
        show={confirmRemove !== null}
        title={dictAdmin.admins.removeConfirmTitle}
        message={dictAdmin.admins.removeConfirmMessage.replace(
          '{user}',
          confirmRemove?.displayLabel ?? confirmRemove?.userId ?? '',
        )}
        confirmLabel={dictAdmin.admins.remove}
        pending={saving}
        onConfirm={handleRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}
