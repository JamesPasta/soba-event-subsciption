'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { ConfirmModal } from '@/src/components/ConfirmModal';
import {
  StatusTag,
  submitterReviewToVariant,
  workflowStateToVariant,
} from '@/src/components/StatusTag';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { useDictionary } from '@/app/[lang]/Providers';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import {
  canContinueSubmission,
  canDeleteOwnSubmission,
  canReviseSubmission,
} from '@/src/shared/util/permissions';
import { fillTemplate } from '@/src/shared/util/stringUtils';
import { useFormatLongDateTime } from '@/src/shared/hooks/useFormatLongDate';
import { isConflict, apiErrorMessage } from '@/src/shared/api/dataError';
import { useAccessCaller } from '@/src/shared/api/useAccessCaller';
import { useDataErrorNotice } from '@/src/shared/api/useDataErrorNotice';
import { MY_SUBMISSIONS_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import {
  useMySubmissionDeleter,
  useMySubmissionReviser,
  useMySubmissions,
} from '@/src/features/submit-mode/data/useMySubmissions';
import {
  MY_SUBMISSION_STATES,
  type MySubmissionRow,
  type MySubmissionState,
} from '@/src/types/submissions';
import styles from './MySubmissionsList.module.css';

const ALL_STATES = 'all';

const toState = (raw: string | undefined): MySubmissionState | undefined =>
  MY_SUBMISSION_STATES.find((state) => state === raw);

/** The caller's own drafts and submitted submissions: continue one still writable, view any other. */
export function MySubmissionsList() {
  const dict = useDictionary();
  const dictMine = dict.mySubmissions;
  const { authenticated, initializing } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const notifyError = useDataErrorNotice();
  const router = useRouter();
  const locale = getLocaleFromPath(usePathname());
  const formatDateTime = useFormatLongDateTime();
  // Continue and Delete read the caller's provider, so rows wait for it.
  const { caller, pending: callerPending } = useAccessCaller();

  const listQuery = useListQuery(MY_SUBMISSIONS_LIST_QUERY);
  const rawState = listQuery.filters.state;
  const state = toState(rawState);
  const submissions = useMySubmissions(
    {
      offset: listQuery.offset,
      limit: listQuery.pageSize,
      sort: listQuery.sort,
      q: listQuery.q,
    },
    state,
  );
  const { table } = useDataTable(listQuery, submissions, dictMine.loadError);
  const { remove } = useMySubmissionDeleter();
  const { revise } = useMySubmissionReviser();

  const [confirmDelete, setConfirmDelete] = useState<MySubmissionRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmRevise, setConfirmRevise] = useState<MySubmissionRow | null>(null);
  const [revising, setRevising] = useState(false);

  const { setFilters } = listQuery;
  // A state the API would refuse reads as no filter; drop it so the URL and the Select agree.
  useEffect(() => {
    if (rawState && !state) setFilters({});
  }, [rawState, state, setFilters]);

  const labelValues = useCallback(
    (item: MySubmissionRow) => ({
      form: item.formName,
      updated: formatDateTime(item.updatedAt),
    }),
    [formatDateTime],
  );

  // Continue when the caller may still write it; any other row, a missing form included, opens the
  // read-only view.
  const continues = useCallback(
    (item: MySubmissionRow) => !!item.form && canContinueSubmission(item, item.form, caller),
    [caller],
  );

  const openSubmission = useCallback(
    (item: MySubmissionRow) =>
      router.push(
        continues(item) ? `/${locale}/submit/${item.id}` : `/${locale}/submission/${item.id}`,
      ),
    [router, locale, continues],
  );

  const handleDelete = useCallback(() => {
    const item = confirmDelete;
    if (!item) return;
    setDeleting(true);
    remove(item.id)
      .then((outcome) => {
        switch (outcome.status) {
          case 'applied':
            addNotification({ text: dictMine.deleteSuccess, type: 'success' });
            break;
          case 'held':
          case 'queued':
            // Not deleted yet; the re-read list shows the row as it stands.
            break;
        }
      })
      .catch((cause: unknown) => {
        // The only delete the server answers with 409 is one already submitted, coded or not.
        const message =
          apiErrorMessage(cause, dict.apiErrors) ??
          (isConflict(cause) ? dict.apiErrors.delete_closed : null);
        notifyError(
          cause,
          message ? { failed: message, forbidden: message } : { failed: dictMine.deleteError },
        );
      })
      .finally(() => {
        setDeleting(false);
        setConfirmDelete(null);
      });
  }, [
    confirmDelete,
    remove,
    addNotification,
    notifyError,
    dictMine.deleteSuccess,
    dict.apiErrors,
    dictMine.deleteError,
  ]);

  // Revise, by the rule the server applies: the signed-in owner, the form's setting, and a
  // submission no reviewer has taken up.
  const revisable = useCallback(
    (item: MySubmissionRow) => !!item.form && canReviseSubmission(item, item.form, caller),
    [caller],
  );

  const handleRevise = useCallback(() => {
    const item = confirmRevise;
    if (!item) return;
    setRevising(true);
    revise(item.id)
      .then(() => {
        addNotification({ text: dictMine.reviseSuccess, type: 'success' });
        router.push(`/${locale}/submit/${item.id}`);
      })
      .catch((cause: unknown) => {
        const message = apiErrorMessage(cause, dict.apiErrors);
        notifyError(
          cause,
          message ? { failed: message, forbidden: message } : { failed: dictMine.reviseError },
        );
      })
      .finally(() => {
        setRevising(false);
        setConfirmRevise(null);
      });
  }, [
    confirmRevise,
    revise,
    addNotification,
    notifyError,
    router,
    locale,
    dict.apiErrors,
    dictMine.reviseSuccess,
    dictMine.reviseError,
  ]);

  const handleStateChange = useCallback(
    (key: string | number | null) =>
      setFilters(key && key !== ALL_STATES ? { state: String(key) } : {}),
    [setFilters],
  );

  const stateOptions = useMemo(
    () => [
      { id: ALL_STATES, label: dictMine.allStates },
      ...MY_SUBMISSION_STATES.map((value) => ({ id: value, label: dictMine.states[value] })),
    ],
    [dictMine.allStates, dictMine.states],
  );

  const columns: Column<MySubmissionRow>[] = useMemo(
    () => [
      {
        key: 'formName',
        label: dictMine.columns.form,
        width: '40%',
        sortField: 'formName',
        render: (item) => (
          <RowActionButton
            main
            data-testid={`my-submission-link-${item.id}`}
            onPress={() => openSubmission(item)}
          >
            {item.formName}
          </RowActionButton>
        ),
      },
      {
        key: 'workflowState',
        label: dictMine.columns.status,
        // Once submitted, the row says where the review stands, as the submitter is told it.
        render: (item) => (
          <StatusTag
            label={
              item.reviewStatus
                ? dictMine.reviewStatuses[item.reviewStatus]
                : dictMine.states[item.workflowState]
            }
            variant={
              item.reviewStatus
                ? submitterReviewToVariant(item.reviewStatus)
                : workflowStateToVariant(item.workflowState)
            }
            data-testid={`${item.id}-status`}
          />
        ),
      },
      {
        key: 'confirmationCode',
        label: dictMine.columns.confirmationId,
        render: (item) => (
          <span data-testid={`${item.id}-confirmation-id`}>
            {item.confirmationCode ?? (
              <>
                <span aria-hidden="true">—</span>
                <span className="visually-hidden">{dictMine.noCode}</span>
              </>
            )}
          </span>
        ),
      },
      {
        key: 'updatedAt',
        label: dictMine.columns.updatedAt,
        sortField: 'updatedAt',
        sortDefaultDirection: 'desc',
        render: (item) => (
          <span className="small" data-testid={`${item.id}-updated-date`}>
            {formatDateTime(item.updatedAt)}
          </span>
        ),
      },
      {
        key: 'actions',
        label: dictMine.columns.actions,
        align: 'start',
        render: (item) => {
          const toFill = continues(item);
          const values = labelValues(item);
          return (
            <div className="d-flex gap-2 justify-content-start">
              <RowActionButton
                aria-label={fillTemplate(
                  toFill ? dictMine.continueLabel : dictMine.viewLabel,
                  values,
                )}
                data-testid={`${item.id}-${toFill ? 'continue' : 'view'}`}
                onPress={() => openSubmission(item)}
              >
                {toFill ? dictMine.continue : dictMine.view}
              </RowActionButton>
              {revisable(item) ? (
                <RowActionButton
                  aria-label={fillTemplate(dictMine.reviseLabel, values)}
                  data-testid={`${item.id}-revise`}
                  onPress={() => setConfirmRevise(item)}
                >
                  {dictMine.revise}
                </RowActionButton>
              ) : null}
              {canDeleteOwnSubmission(item, caller) ? (
                <RowActionButton
                  aria-label={fillTemplate(dictMine.deleteLabel, values)}
                  data-testid={`${item.id}-delete`}
                  onPress={() => setConfirmDelete(item)}
                >
                  {dictMine.delete}
                </RowActionButton>
              ) : null}
            </div>
          );
        },
      },
    ],
    [dictMine, caller, continues, revisable, formatDateTime, labelValues, openSubmission],
  );

  // Loading, including Keycloak init, shows inside the table so the heading stays put.
  if (!authenticated && !initializing) {
    return <ListPageAuthGate>{dict.general.notAuthenticated}</ListPageAuthGate>;
  }

  const filtered = !!listQuery.q || !!state;

  return (
    <>
      <ListPageToolbar>
        <ListPageSearchField
          value={listQuery.searchInput}
          onChange={listQuery.setSearchInput}
          onSubmit={listQuery.commitSearch}
          testIdPrefix="my-submissions"
        />
      </ListPageToolbar>
      <ListPageFilters>
        {/* The design system replaces its own root class when given one, so the width sits
            on a wrapper. */}
        <div className={styles.stateField}>
          <Select
            size="medium"
            id="my-submissions-state"
            data-testid="my-submissions-state-select"
            label={dictMine.statusFilter}
            selectedKey={state ?? ALL_STATES}
            onSelectionChange={handleStateChange}
            items={stateOptions}
          />
        </div>
        <DSButton
          variant="secondary"
          data-testid="my-submissions-clear-filters"
          onPress={listQuery.clear}
        >
          {dict.general.clearFilters}
        </DSButton>
      </ListPageFilters>

      <DataTable<MySubmissionRow>
        {...table}
        loading={table.loading || initializing || callerPending}
        columns={columns}
        emptyMessage={filtered ? dictMine.noMatches : dictMine.empty}
        loadingMessage={dict.general.loading}
        itemName={dictMine.itemName}
        caption={dict.general.mySubmissions}
        keyExtractor={(item) => item.id}
      />

      <ConfirmModal
        show={confirmDelete !== null}
        title={dictMine.deleteTitle}
        message={
          confirmDelete ? fillTemplate(dictMine.deleteMessage, labelValues(confirmDelete)) : ''
        }
        confirmLabel={dictMine.delete}
        pending={deleting}
        onConfirm={handleDelete}
        onCancel={() => {
          // The delete in flight closes the dialog when it settles.
          if (!deleting) setConfirmDelete(null);
        }}
      />

      <ConfirmModal
        show={confirmRevise !== null}
        title={dictMine.reviseTitle}
        message={
          confirmRevise ? fillTemplate(dictMine.reviseMessage, labelValues(confirmRevise)) : ''
        }
        confirmLabel={dictMine.revise}
        pending={revising}
        onConfirm={handleRevise}
        onCancel={() => {
          if (!revising) setConfirmRevise(null);
        }}
      />
    </>
  );
}
