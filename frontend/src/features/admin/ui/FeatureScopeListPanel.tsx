'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button, InlineAlert, Switch } from '@bcgov/design-system-react-components';
import { usePathname, useRouter } from 'next/navigation';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { DataTable, type Column } from '@/src/components/DataTable';
import { ListPageToolbar } from '@/src/components/ListPageLayout';
import { RowActionButton } from '@/src/components/RowActionButton';
import { SecondaryText } from '@/src/components/SecondaryText';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useDictionary } from '@/app/[lang]/Providers';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { useFeatureScopes, useFeatureScopeWriter } from '../data/useAdminData';
import { FEATURE_SCOPES_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import type { FeatureScopeItem, FeatureScopeStatus } from '@/src/types/admin';
import styles from './AdminPanel.module.css';

type FeatureScopeListPanelProps = {
  /** Feature codes that are currently available for per-scope administration. */
  scopedFeatureCodes: string[];
};

export function FeatureScopeListPanel({
  scopedFeatureCodes,
}: Readonly<FeatureScopeListPanelProps>) {
  const dict = useDictionary();
  const dictScopes = dict.admin.featureScopes;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const router = useRouter();
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FeatureScopeItem | null>(null);

  const query = useListQuery(FEATURE_SCOPES_LIST_QUERY);
  const scopes = useFeatureScopes(scopedFeatureCodes, {
    offset: query.offset,
    limit: query.pageSize,
    sort: query.sort,
    q: query.q,
  });
  const { table, refresh: reload } = useDataTable(query, scopes, dictScopes.loadError);
  const scopeWriter = useFeatureScopeWriter();

  const handleStatusChange = useCallback(
    (featureScope: FeatureScopeItem, selected: boolean) => {
      if (!token || pendingId) return;
      const nextStatus: FeatureScopeStatus = selected ? 'active' : 'inactive';
      setPendingId(featureScope.id);
      scopeWriter
        .upsert(token, {
          featureCode: featureScope.featureCode,
          scopeType: featureScope.scopeType,
          scopeId: featureScope.scopeId,
          status: nextStatus,
        })
        .then(() => {
          addNotification({ text: dictScopes.saveSuccess, type: 'success' });
        })
        .catch((cause: unknown) => {
          addNotification({ text: dictScopes.saveError, type: 'error', consoleError: cause });
          // A failed toggle leaves the switch on the value it snapped to; re-read to reset it.
          void reload();
        })
        .finally(() => {
          setPendingId(null);
        });
    },
    [
      token,
      pendingId,
      scopeWriter,
      addNotification,
      dictScopes.saveSuccess,
      dictScopes.saveError,
      reload,
    ],
  );

  const handleDelete = useCallback(() => {
    const featureScope = confirmDelete;
    if (!token || pendingId || !featureScope) return;
    setPendingId(featureScope.id);
    scopeWriter
      .remove(token, featureScope.id)
      .then(() => {
        addNotification({ text: dictScopes.deleteSuccess, type: 'success' });
      })
      .catch((cause: unknown) => {
        addNotification({ text: dictScopes.deleteError, type: 'error', consoleError: cause });
        void reload();
      })
      .finally(() => {
        setPendingId(null);
        setConfirmDelete(null);
      });
  }, [
    token,
    pendingId,
    confirmDelete,
    scopeWriter,
    reload,
    addNotification,
    dictScopes.deleteSuccess,
    dictScopes.deleteError,
  ]);

  const columns: Column<FeatureScopeItem>[] = useMemo(
    () => [
      {
        key: 'featureCode',
        label: dictScopes.columns.feature,
        sortField: 'featureCode',
        width: '40%',
        render: (featureScope) => (
          <span className="d-inline-flex flex-column">
            <span>{featureScope.featureCode}</span>
            <SecondaryText>{featureScope.id}</SecondaryText>
          </span>
        ),
      },
      {
        key: 'scopeType',
        label: dictScopes.columns.scope,
        sortField: 'scopeType',
        render: (featureScope) => dictScopes.scopeTypes[featureScope.scopeType],
      },
      {
        key: 'scopeId',
        label: dictScopes.columns.scopeId,
        render: (featureScope) => <SecondaryText>{featureScope.scopeId}</SecondaryText>,
      },
      {
        key: 'status',
        label: dictScopes.columns.status,
        sortField: 'status',
        align: 'center',
        render: (featureScope) => (
          <Switch
            isSelected={featureScope.status === 'active'}
            isDisabled={pendingId === featureScope.id}
            aria-label={dictScopes.statusToggleLabel
              .replace('{featureCode}', featureScope.featureCode)
              .replace('{scopeType}', dictScopes.scopeTypes[featureScope.scopeType])
              .replace('{scopeId}', featureScope.scopeId)}
            onChange={(selected) => handleStatusChange(featureScope, selected)}
            data-testid={`feature-scope-status-${featureScope.id}`}
          />
        ),
      },
      {
        key: 'updatedAt',
        label: dictScopes.columns.updated,
        sortField: 'updatedAt',
        render: (featureScope) => new Date(featureScope.updatedAt).toLocaleString(dict.locale),
      },
      {
        key: 'actions',
        label: dictScopes.columns.actions,
        render: (featureScope) => (
          <div className="d-flex gap-2 justify-content-start">
            <RowActionButton
              data-testid={`manage-feature-scope-${featureScope.id}`}
              onPress={() => router.push(`/${locale}/admin/feature-scopes/${featureScope.id}`)}
            >
              {dictScopes.manage}
            </RowActionButton>
            <RowActionButton
              data-testid={`delete-feature-scope-${featureScope.id}`}
              onPress={() => setConfirmDelete(featureScope)}
            >
              {dictScopes.delete}
            </RowActionButton>
          </div>
        ),
      },
    ],
    [dictScopes, pendingId, handleStatusChange, router, locale, dict.locale],
  );

  return (
    <div className={styles.tabContent}>
      <p className={styles.panelIntro}>{dictScopes.intro}</p>
      <ListPageToolbar align="end">
        <Button
          variant="primary"
          isDisabled={scopedFeatureCodes.length === 0}
          data-testid="create-feature-scope-button"
          onPress={() => router.push(`/${locale}/admin/feature-scopes/create`)}
        >
          {dictScopes.create}
        </Button>
      </ListPageToolbar>
      {scopedFeatureCodes.length === 0 ? (
        <InlineAlert
          description={dictScopes.noScopedFeatures}
          title={dictScopes.featureCodeLabel}
          variant="info"
          data-testid="feature-scope-none"
        />
      ) : (
        <DataTable<FeatureScopeItem>
          {...table}
          columns={columns}
          emptyMessage={dictScopes.empty}
          loadingMessage={dict.general.loading}
          caption={dictScopes.heading}
          keyExtractor={(featureScope) => featureScope.id}
        />
      )}
      <ConfirmModal
        show={confirmDelete !== null}
        title={dictScopes.deleteConfirmTitle}
        message={
          confirmDelete
            ? dictScopes.deleteConfirmMessage
                .replace('{featureCode}', confirmDelete.featureCode)
                .replace('{scopeType}', dictScopes.scopeTypes[confirmDelete.scopeType])
            : ''
        }
        confirmLabel={dictScopes.delete}
        pending={pendingId !== null}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
