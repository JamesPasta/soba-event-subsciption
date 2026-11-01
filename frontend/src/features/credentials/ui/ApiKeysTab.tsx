'use client';

import { useMemo, useState } from 'react';
import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import { ListPageToolbar } from '@/src/components/ListPageLayout';
import { DataTable, type Column } from '@/src/components/DataTable';
import { RowActionButton } from '@/src/components/RowActionButton';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { ListPageSearchField } from '@/src/components/ListPageSearchField';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { apiErrorMessage } from '@/src/shared/api/dataError';
import { useFormatLongDateTime } from '@/src/shared/hooks/useFormatLongDate';
import { CREDENTIALS_LIST_QUERY, scopedListQuery } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import type { Dictionary } from '@/src/types/dictionary';
import type { CredentialMetadata, CredentialOwner } from '@/src/types/credentials';
import { useCredentials } from '../data/useCredentials';
import { useCredentialWriter } from '../data/useCredentialWriter';
import { ApiKeyForm } from './ApiKeyForm';

export interface ApiKeysTabProps {
  dict: Dictionary;
  owner: CredentialOwner;
}

/** What opens under the table: nothing, the add form, or the edit form for one key's id. */
type FormView = null | 'new' | { credentialId: string };

/** A form's list also holds its workspace's keys, which only the workspace can change. */
const ownedBy = (kind: CredentialOwner['kind'], row: CredentialMetadata) => row.scope === kind;
/** The server refuses to delete a key that is pending or unknown. */
const deletable = (row: CredentialMetadata) => row.status === 'active' || row.status === 'failed';

export function ApiKeysTab({ dict, owner }: Readonly<ApiKeysTabProps>) {
  const t = dict.apiKeys;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const formatDate = useFormatLongDateTime();

  const listSpec = useMemo(
    () => scopedListQuery(CREDENTIALS_LIST_QUERY, `${owner.kind}:${owner.id}`),
    [owner.kind, owner.id],
  );
  const query = useListQuery(listSpec);
  const keys = useCredentials(owner, {
    offset: query.offset,
    limit: query.pageSize,
    sort: query.sort,
    q: query.q,
  });
  const { table } = useDataTable(query, keys, t.loadError);
  const writer = useCredentialWriter(owner);

  const [formView, setFormView] = useState<FormView>(null);
  const [pendingDelete, setPendingDelete] = useState<CredentialMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Held while the form issues or shows a key, or holds a new key not yet saved.
  const [formHeld, setFormHeld] = useState(false);

  const confirmDelete = async () => {
    if (!token || !pendingDelete) return;
    setIsDeleting(true);
    try {
      await writer.remove(token, pendingDelete.id);
      addNotification({ text: t.deleteSuccess, type: 'success' });
      // Close the edit form only if it was for the key just deleted.
      const removedId = pendingDelete.id;
      setFormView((view) =>
        view && view !== 'new' && view.credentialId === removedId ? null : view,
      );
      setPendingDelete(null);
    } catch (err: unknown) {
      addNotification({
        text: apiErrorMessage(err, dict.apiErrors) ?? t.deleteError,
        type: 'error',
        consoleError: err,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: Column<CredentialMetadata>[] = useMemo(() => {
    const typeLabel = { api: t.apiAccess, 'web-component': t.webComponents };
    const scopeColumn: Column<CredentialMetadata>[] =
      owner.kind === 'form'
        ? [
            {
              key: 'scope',
              label: t.columns.scope,
              render: (row) => (row.scope === 'form' ? t.scopeForm : t.scopeWorkspace),
            },
          ]
        : [];
    return [
      {
        key: 'createdAt',
        label: t.columns.createdAt,
        sortField: 'createdAt',
        sortDefaultDirection: 'desc',
        render: (row) => formatDate(row.createdAt),
      },
      {
        key: 'label',
        label: t.columns.label,
        sortField: 'label',
        render: (row) => <span data-testid={`api-key-label-${row.id}`}>{row.label}</span>,
      },
      { key: 'notes', label: t.columns.notes },
      {
        key: 'types',
        label: t.columns.types,
        render: (row) => row.types.map((type) => typeLabel[type]).join(', '),
      },
      ...scopeColumn,
      {
        key: 'status',
        label: t.columns.status,
        sortField: 'status',
        render: (row) => (
          <span data-testid={`api-key-status-${row.id}`}>{t.statuses[row.status]}</span>
        ),
      },
      {
        key: 'actions',
        label: t.columns.actions,
        align: 'end',
        render: (row) =>
          ownedBy(owner.kind, row) && (
            <div>
              <RowActionButton
                isDisabled={formHeld}
                onPress={() => setFormView({ credentialId: row.id })}
                aria-label={`${t.edit}: ${row.label}`}
                data-testid={`api-key-edit-${row.id}`}
              >
                {t.edit}
              </RowActionButton>
              {deletable(row) && (
                <RowActionButton
                  isDisabled={formHeld}
                  onPress={() => setPendingDelete(row)}
                  aria-label={`${t.delete}: ${row.label}`}
                  data-testid={`api-key-delete-${row.id}`}
                >
                  {t.delete}
                </RowActionButton>
              )}
            </div>
          ),
      },
    ];
  }, [t, owner.kind, formatDate, formHeld]);

  const editingId = formView && formView !== 'new' ? formView.credentialId : undefined;
  const deleteMessage =
    pendingDelete?.status === 'failed' ? t.deleteFailedConfirmMessage : t.deleteConfirmMessage;

  return (
    <div data-testid="api-keys-tab-content">
      {keys.available === false && (
        <InlineAlert variant="info" description={t.unavailable} data-testid="api-key-unavailable" />
      )}
      <ListPageToolbar>
        <ListPageSearchField
          value={query.searchInput}
          onChange={query.setSearchInput}
          onSubmit={query.commitSearch}
          testIdPrefix="api-keys"
        />
        <Button
          variant="primary"
          data-testid="api-key-add"
          isDisabled={keys.available !== true || formHeld}
          onPress={() => setFormView((view) => (view === 'new' ? null : 'new'))}
        >
          {t.add}
        </Button>
      </ListPageToolbar>

      <DataTable<CredentialMetadata>
        {...table}
        columns={columns}
        emptyMessage={t.empty}
        loadingMessage={dict.general.loading}
        itemName="items"
        keyExtractor={(row) => row.id}
      />

      {formView && (
        <ApiKeyForm
          key={editingId ?? 'new'}
          dict={dict}
          owner={owner}
          credentialId={editingId}
          available={keys.available === true}
          onHoldChange={setFormHeld}
          onDone={() => setFormView(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          show
          title={t.deleteConfirmTitle}
          message={deleteMessage.replace('{label}', () => pendingDelete.label)}
          confirmLabel={t.delete}
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

export default ApiKeysTab;
