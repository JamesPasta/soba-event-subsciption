'use client';

import { useMemo, useCallback, useEffect, useState } from 'react';
import { Button as DSButton } from '@bcgov/design-system-react-components';
import { DataTable, type Column } from '@/src/components/DataTable';
import { Tag } from '@/src/components/Tag';
import {
  ListPageAuthGate,
  ListPageFilters,
  ListPageToolbar,
} from '@/src/components/ListPageLayout';
import { ListPageSearchField } from '@/src/components/ListPageSearchField';
import { RowActionButton } from '@/src/components/RowActionButton';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useDictionary } from '@/app/[lang]/Providers';
import { useRouter, usePathname } from 'next/navigation';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { isUuid } from '@/src/shared/util/uuid';
import type { SobaFormSummary } from '@/src/types/forms';
import { useFormatLongDate } from '@/src/shared/hooks/useFormatLongDate';
import { usePageNotices } from '@/src/components/PageHeader';
import { useWorkspace, useWorkspaceOptions } from '@/src/shared/api/useWorkspaces';
import { useCurrentUser } from '@/src/shared/api/useCurrentUser';
import { classifyDataError, messageForDataError } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { lookupTruncatedNote, withSelectedOption } from '@/src/shared/list/lookupOptions';
import { FORMS_LIST_QUERY, rememberListQuery } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import { useFormsList } from '@/src/features/designer/data/useFormsList';
import { WorkspaceSelector } from '@/app/ui/WorkspaceSelector';
import { FaDatabase, FaLink } from 'react-icons/fa6';
import styles from './FormList.module.css';
import type { WorkspaceLookupItem } from '@/src/types/workspaces';
import { Modal } from '@/src/components/Modal';
import { FormCreateContent } from './FormCreateContent';

/**
 * Resolves the URL's workspace filter, which can name a workspace that does not exist or that this
 * user cannot see. A workspace in the options is taken from there; any other is read, because the
 * options stop at the lookup limit.
 */
function useWorkspaceFilter(
  workspaceParam: string | null,
  options: Pick<ReturnType<typeof useWorkspaceOptions>, 'workspaces' | 'loaded' | 'error'>,
) {
  // Not a workspace id at all. Reading one fails as a server error rather than a refusal.
  const paramIsId = !!workspaceParam && isUuid(workspaceParam);
  const listed = paramIsId ? options.workspaces.find((w) => w.id === workspaceParam) : undefined;
  const optionsSettled = options.loaded || !!options.error;
  const { workspace: read, error } = useWorkspace(
    paramIsId && optionsSettled && !listed ? (workspaceParam as string) : undefined,
  );
  const workspace: WorkspaceLookupItem | null = listed ?? read;
  // Only a refusal says the workspace is not this user's. Any other failure is a failed load.
  const refused = error?.kind === 'forbidden' || error?.kind === 'notFound';
  return {
    workspace,
    rejected: !!workspaceParam && !workspace && (!paramIsId || refused),
    loadError: refused ? undefined : error,
    // No answer yet, so the table is loading, not empty.
    pending: paramIsId && !workspace && !error,
    // A filter that could still name one of the user's workspaces never reads unscoped.
    holdRequest: paramIsId && !workspace && !refused,
  };
}

const CustomActionButtons = ({
  form,
  onAction,
  submitLabel,
  submissionsLabel,
}: {
  form: SobaFormSummary;
  onAction: (name: string, id: string) => void;
  submitLabel: string;
  submissionsLabel: string;
}) => {
  // Actions are keyed on the SOBA formId.
  const sobaFormId = form.id;

  const actions = [
    { name: 'submit', icon: <FaLink />, ariaLabel: submitLabel },
    { name: 'submissions', icon: <FaDatabase />, ariaLabel: submissionsLabel },
  ];

  return (
    <div className="d-flex gap-2 justify-content-start">
      {actions.map((action) => (
        <RowActionButton
          key={action.name}
          aria-label={action.ariaLabel}
          data-testid={action.name + '-' + sobaFormId + '-button'}
          onPress={() => {
            if (!sobaFormId) return;
            onAction(action.name, sobaFormId);
          }}
        >
          {action.icon}
        </RowActionButton>
      ))}
    </div>
  );
};

function FormList() {
  const dict = useDictionary();
  const dictFormList = dict.submission?.formList;
  const dictForm = dict.form;
  const { authenticated, initializing } = useKeycloak();

  const router = useRouter();
  const pathname = usePathname();

  const locale = getLocaleFromPath(pathname);

  const { data: currentUser } = useCurrentUser();
  const workspaceOptions = useWorkspaceOptions();

  const listQuery = useListQuery(FORMS_LIST_QUERY);
  const workspaceParam = listQuery.filters.workspace ?? null;
  const workspaceFilter = useWorkspaceFilter(workspaceParam, workspaceOptions);
  const filterWorkspace = workspaceFilter.workspace;
  const selectedWorkspaceId = filterWorkspace?.id;
  const workspaceRejected = workspaceFilter.rejected;
  const holdFormsRequest = workspaceFilter.holdRequest;

  const [showCreateModal, setShowCreateModal] = useState(false);

  // Wait for the filter to resolve before reading, or the first arrival scopes to no workspace. A
  // refused or malformed id reads unscoped on purpose: the picker reads "all workspaces" and the
  // notice says the filter was not applied.
  const formsList = useFormsList(
    {
      offset: listQuery.offset,
      limit: listQuery.pageSize,
      sort: listQuery.sort,
      q: listQuery.q,
    },
    selectedWorkspaceId,
    holdFormsRequest,
  );
  const { table } = useDataTable(listQuery, formsList, dict.form.loadFormsError);

  const authDefaults = useAuthErrorDefaults();
  const optionsError = workspaceOptions.error;
  const filterLoadError = workspaceFilter.loadError;
  const error = useMemo(() => {
    const failure =
      formsList.error ??
      (optionsError ? classifyDataError(optionsError) : null) ??
      filterLoadError ??
      null;
    return failure
      ? messageForDataError(failure, { ...authDefaults, failed: dict.form.loadFormsError })
      : null;
  }, [formsList.error, optionsError, filterLoadError, authDefaults, dict.form.loadFormsError]);

  // A filter this user cannot resolve is not a view worth restoring. Without this it stays in the
  // memory and every later arrival from the nav replays it and raises the same notice again.
  useEffect(() => {
    if (workspaceRejected) rememberListQuery(FORMS_LIST_QUERY, {});
  }, [workspaceRejected]);

  // The picker filters this list only; a new form is targeted in the designer. So creation
  // depends on having any workspace the user can create in with its disclaimer accepted.
  const formCreate = currentUser?.capabilities?.formCreate;
  const canCreate = formCreate === 'allowed';
  // Create permission somewhere but no disclaimer accepted yet: the case worth prompting on.
  const needsDisclaimer = formCreate === 'disclaimer_required';

  const pickerWorkspaces = useMemo(
    () => withSelectedOption(workspaceOptions.workspaces, filterWorkspace),
    [workspaceOptions.workspaces, filterWorkspace],
  );

  const { setFilters } = listQuery;
  const handleWorkspaceChange = useCallback(
    (key: string | number | null) => setFilters(key ? { workspace: String(key) } : {}),
    [setFilters],
  );

  const handleAction = useCallback(
    (name: string, id: string) => {
      if (name === 'manage') {
        router.push(`/${locale}/build/${id}`);
      } else if (name === 'submit') {
        router.push(`/${locale}/build/${id}?tab=share`);
      } else if (name === 'submissions') {
        router.push(`/${locale}/build/${id}?tab=submissions`);
      }
    },
    [router, locale],
  );

  usePageNotices([
    workspaceRejected && {
      id: 'workspace-filter',
      variant: 'warning' as const,
      body: dict.workspaces.unavailableFilter,
      action: {
        label: dict.workspaces.clearFilter,
        onPress: () => setFilters({}),
      },
    },
    needsDisclaimer && {
      id: 'disclaimer',
      variant: 'warning' as const,
      body:
        dict.form.disclaimerRequired ||
        'Accept the workspace disclaimer in workspace Settings before creating a form.',
    },
  ]);

  const formatLongDate = useFormatLongDate();

  const columns: Column<SobaFormSummary>[] = useMemo(
    () => [
      {
        key: 'name',
        label: dictFormList?.columns?.name || dictForm?.nameLabel || 'Form Name',
        width: '40%',
        sortField: 'name',
        render: (form: SobaFormSummary) => {
          return (
            <RowActionButton
              main
              data-testid={'form-link-' + form.id}
              onPress={() => handleAction('manage', form.id)}
            >
              {form.name || dictForm?.nameLabel || 'Untitled Form'}
            </RowActionButton>
          );
        },
      },
      {
        key: 'workspace',
        label: dict.workspaces?.workspace || 'Workspace',
        render: (form: SobaFormSummary) => (
          <Tag text={form.workspaceName} color="yellow" data-testid={`workspace-tag-${form.id}`} />
        ),
      },
      {
        key: 'actions',
        label: dictFormList?.columns?.quickLinks || 'Quick Links',
        align: 'start',
        render: (form: SobaFormSummary) => (
          <CustomActionButtons
            form={form}
            onAction={handleAction}
            submitLabel={dictForm?.submit || 'Submit'}
            submissionsLabel={dict.submission?.submissions || 'Submissions'}
          />
        ),
      },
      {
        key: 'createdAt',
        label: dictFormList?.columns?.createdAt || 'Created Date',
        sortField: 'createdAt',
        sortDefaultDirection: 'desc',
        render: (form: SobaFormSummary) => (
          <span className="small">{formatLongDate(form.createdAt)}</span>
        ),
      },
      {
        key: 'createdBy',
        label: dictFormList?.columns?.createdBy || 'Created By',
        render: (form: SobaFormSummary) => {
          if (!form.createdBy) return <span className="text-muted small">—</span>;
          return <span className="small">{form.createdBy}</span>;
        },
      },
    ],
    [
      dictForm?.submit,
      dict.submission?.submissions,
      dict.workspaces?.workspace,
      dictForm?.nameLabel,
      dictFormList?.columns?.createdAt,
      dictFormList?.columns?.createdBy,
      dictFormList?.columns?.name,
      dictFormList?.columns?.quickLinks,
      formatLongDate,
      handleAction,
    ],
  );

  const hideModal = () => {
    setShowCreateModal(false);
  };

  // Auth gate only — loading (including Keycloak init) is shown inside the table
  // body so the page heading stays visible throughout.
  if (!authenticated && !initializing) {
    return <ListPageAuthGate>{dict.general.notAuthenticated}</ListPageAuthGate>;
  }

  return (
    <>
      <Modal show={showCreateModal} onClose={hideModal} title={dict.form.createForm}>
        <FormCreateContent onCancelPress={hideModal} />
      </Modal>
      <ListPageToolbar>
        <ListPageSearchField
          value={listQuery.searchInput}
          onChange={listQuery.setSearchInput}
          onSubmit={listQuery.commitSearch}
          testIdPrefix="forms"
        />
        <DSButton
          variant="primary"
          data-testid="create-form-button"
          isDisabled={!canCreate}
          onPress={() => setShowCreateModal(true)}
        >
          {dict.general.create}
        </DSButton>
      </ListPageToolbar>
      <ListPageFilters>
        <WorkspaceSelector
          className={`${styles.workspaceField}`}
          workspaces={pickerWorkspaces}
          selectedWorkspaceId={selectedWorkspaceId ?? null}
          label={dict.workspaces.workspace}
          onChange={handleWorkspaceChange}
          allLabel={dict.workspaces.allWorkspaces}
          description={lookupTruncatedNote(dict.general.lookupTruncated, workspaceOptions)}
          size="medium"
        />
        <DSButton variant="secondary" data-testid="clear-filters-button" onPress={listQuery.clear}>
          {dict.general.clearFilters || 'Clear'}
        </DSButton>
      </ListPageFilters>

      <DataTable<SobaFormSummary>
        {...table}
        loading={table.loading || initializing || workspaceFilter.pending}
        error={error}
        columns={columns}
        emptyMessage="No forms found matching your criteria."
        loadingMessage={dict.general.loading}
        itemName="items"
        caption={dict.general.forms}
        keyExtractor={(form) => form.id}
      />
    </>
  );
}

export default FormList;
