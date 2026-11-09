'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Button as DSButton, Select } from '@bcgov/design-system-react-components';
import { usePathname, useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/src/components/DataTable';
import {
  ListPageAuthGate,
  ListPageFilters,
  ListPageToolbar,
} from '@/src/components/ListPageLayout';
import { ListPageSearchField } from '@/src/components/ListPageSearchField';
import { RowActionButton } from '@/src/components/RowActionButton';
import { Tag } from '@/src/components/Tag';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useAccessCaller } from '@/src/shared/api/useAccessCaller';
import { useDictionary } from '@/app/[lang]/Providers';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { fillTemplate } from '@/src/shared/util/stringUtils';
import { isUuid } from '@/src/shared/util/uuid';
import { canStartSubmission } from '@/src/shared/util/permissions';
import { useDataErrorNotice } from '@/src/shared/api/useDataErrorNotice';
import { lookupTruncatedNote } from '@/src/shared/list/lookupOptions';
import { MY_FORMS_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import { useMyForms, useMyWorkspaceOptions } from '@/src/features/submit-mode/data/useMyForms';
import type { MyFormListItem } from '@/src/types/forms';
import styles from './MyFormsList.module.css';

const ALL_WORKSPACES = 'all';

type WorkspaceOptions = ReturnType<typeof useMyWorkspaceOptions>;

/**
 * Resolves the URL's workspace filter against the caller's options. A listed id filters. While the
 * options cannot say, because they failed or stopped at the lookup limit, an id still filters: the
 * server only ever narrows to the caller's own forms. An id waits while the options load. Anything
 * else is dropped from the URL.
 */
function resolveWorkspaceFilter(param: string | undefined, options: WorkspaceOptions) {
  if (!param) return { workspaceId: undefined, pending: false, drop: false };
  if (options.workspaces.some((option) => option.id === param)) {
    return { workspaceId: param, pending: false, drop: false };
  }
  if (!isUuid(param)) return { workspaceId: undefined, pending: false, drop: true };
  if (options.error || options.truncated)
    return { workspaceId: param, pending: false, drop: false };
  if (!options.loaded) return { workspaceId: undefined, pending: true, drop: false };
  return { workspaceId: undefined, pending: false, drop: true };
}

/** The forms the caller holds the submitter role on or has submitted to: start a submission. */
export function MyFormsList() {
  const dict = useDictionary();
  const dictMine = dict.myForms;
  const { authenticated, initializing } = useKeycloak();
  const notifyError = useDataErrorNotice();
  const router = useRouter();
  const locale = getLocaleFromPath(usePathname());
  // The audience rule reads the caller's provider, so rows wait for it.
  const { caller, pending: callerPending } = useAccessCaller();

  const listQuery = useListQuery(MY_FORMS_LIST_QUERY);
  const workspaceOptions = useMyWorkspaceOptions();
  const workspaceFilter = resolveWorkspaceFilter(listQuery.filters.workspace, workspaceOptions);
  const workspaceId = workspaceFilter.workspaceId;
  const optionsError = workspaceOptions.error;

  const forms = useMyForms(
    {
      offset: listQuery.offset,
      limit: listQuery.pageSize,
      sort: listQuery.sort,
      q: listQuery.q,
    },
    workspaceId,
    workspaceFilter.pending,
  );
  const { table } = useDataTable(listQuery, forms, dictMine.loadError);

  const { setFilters } = listQuery;
  const dropWorkspace = workspaceFilter.drop;
  useEffect(() => {
    if (dropWorkspace) setFilters({});
  }, [dropWorkspace, setFilters]);

  // Report a failure once while it stands: each retry brings a new error object.
  const optionsFailureNotified = useRef(false);
  useEffect(() => {
    if (!optionsError) {
      optionsFailureNotified.current = false;
      return;
    }
    if (optionsFailureNotified.current) return;
    optionsFailureNotified.current = true;
    notifyError(optionsError.cause, { failed: dictMine.workspacesLoadError });
  }, [optionsError, notifyError, dictMine.workspacesLoadError]);

  const handleWorkspaceChange = useCallback(
    (key: string | number | null) =>
      setFilters(key && key !== ALL_WORKSPACES ? { workspace: String(key) } : {}),
    [setFilters],
  );

  // A filter the options could not list is named from a row in that workspace, when there is one.
  const unlistedName =
    forms.rows.find((row) => row.workspaceId === workspaceId)?.workspaceName ??
    dictMine.selectedWorkspace;
  const workspaceItems = useMemo(() => {
    const items = [
      { id: ALL_WORKSPACES, label: dict.workspaces.allWorkspaces },
      ...workspaceOptions.workspaces.map((option) => ({ id: option.id, label: option.name })),
    ];
    if (workspaceId && !items.some((item) => item.id === workspaceId)) {
      items.push({ id: workspaceId, label: unlistedName });
    }
    return items;
  }, [dict.workspaces.allWorkspaces, workspaceOptions.workspaces, workspaceId, unlistedName]);

  const columns: Column<MyFormListItem>[] = useMemo(
    () => [
      {
        key: 'name',
        label: dictMine.columns.form,
        width: '40%',
        sortField: 'name',
        render: (item) => <span data-testid={`my-form-name-${item.id}`}>{item.name}</span>,
      },
      {
        key: 'workspace',
        label: dictMine.columns.workspace,
        render: (item) => (
          <Tag text={item.workspaceName} color="yellow" data-testid={`${item.id}-workspace`} />
        ),
      },
      {
        key: 'actions',
        label: dictMine.columns.actions,
        align: 'start',
        render: (item) =>
          canStartSubmission(item, caller) ? (
            <RowActionButton
              aria-label={fillTemplate(dictMine.startLabel, { form: item.name })}
              data-testid={`${item.id}-start`}
              onPress={() => router.push(`/${locale}/form/${item.id}`)}
            >
              {dictMine.start}
            </RowActionButton>
          ) : (
            <span data-testid={`${item.id}-not-open`}>
              <span aria-hidden="true">—</span>
              <span className="visually-hidden">{dictMine.notOpen}</span>
            </span>
          ),
      },
    ],
    [dictMine, router, locale, caller],
  );

  // Loading, including Keycloak init, shows inside the table so the heading stays put.
  if (!authenticated && !initializing) {
    return <ListPageAuthGate>{dict.general.notAuthenticated}</ListPageAuthGate>;
  }

  const filtered = !!listQuery.q || !!workspaceId;

  return (
    <>
      <ListPageToolbar>
        <ListPageSearchField
          value={listQuery.searchInput}
          onChange={listQuery.setSearchInput}
          onSubmit={listQuery.commitSearch}
          testIdPrefix="my-forms"
        />
      </ListPageToolbar>
      <ListPageFilters>
        {/* The design system replaces its own root class when given one, so the width sits
            on a wrapper. */}
        <div className={styles.workspaceField}>
          <Select
            size="medium"
            id="my-forms-workspace"
            data-testid="my-forms-workspace-select"
            label={dict.workspaces.workspace}
            description={lookupTruncatedNote(dict.general.lookupTruncated, workspaceOptions)}
            selectedKey={workspaceId ?? ALL_WORKSPACES}
            onSelectionChange={handleWorkspaceChange}
            items={workspaceItems}
          />
        </div>
        <DSButton
          variant="secondary"
          data-testid="my-forms-clear-filters"
          onPress={listQuery.clear}
        >
          {dict.general.clearFilters}
        </DSButton>
      </ListPageFilters>

      <DataTable<MyFormListItem>
        {...table}
        loading={table.loading || initializing || workspaceFilter.pending || callerPending}
        columns={columns}
        emptyMessage={filtered ? dictMine.noMatches : dictMine.empty}
        loadingMessage={dict.general.loading}
        itemName={dictMine.itemName}
        caption={dict.general.myForms}
        keyExtractor={(item) => item.id}
      />
    </>
  );
}
