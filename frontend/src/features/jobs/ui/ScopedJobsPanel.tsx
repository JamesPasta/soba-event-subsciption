'use client';

import { useCallback, useEffect, useMemo, type Key } from 'react';
import { Button, Select } from '@bcgov/design-system-react-components';
import { JOB_STATUSES } from '@soba/lib';
import { useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/src/components/DataTable';
import { RowActionButton } from '@/src/components/RowActionButton';
import { StatusTag } from '@/src/components/StatusTag';
import { useDictionary } from '@/app/[lang]/Providers';
import { fillTemplate } from '@/src/shared/util/stringUtils';
import { useFormatLongDateTime } from '@/src/shared/hooks/useFormatLongDate';
import {
  FORM_JOBS_LIST_QUERY,
  WORKSPACE_JOBS_LIST_QUERY,
  scopedListQuery,
  type ListQueryParams,
} from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import { isUuid } from '@/src/shared/util/uuid';
import type { JobScopeRef, StaffJobFilters, StaffJobListItem } from '@/src/types/jobs';
import { useJobForms, useScopedJobs } from '../data/useScopedJobs';
import { jobStatusVariant, jobTypeLabel, submissionJobTypes, toJobStatus } from '../jobs';
import styles from './Jobs.module.css';

const ALL = 'all';
const ERROR_PREVIEW_LENGTH = 80;

const TYPES = new Set(submissionJobTypes());

/**
 * The filters the URL holds that the fields offer; anything else is dropped. A form is kept until
 * the list of forms with jobs has loaded, then only when it is on it.
 */
const toFilters = (
  params: ListQueryParams,
  scope: JobScopeRef,
  formIds: ReadonlySet<string> | undefined,
): StaffJobFilters => ({
  status: toJobStatus(params.status),
  type: params.type && TYPES.has(params.type) ? params.type : undefined,
  formId:
    scope.kind === 'workspace' &&
    params.formId &&
    isUuid(params.formId) &&
    (formIds === undefined || formIds.has(params.formId))
      ? params.formId
      : undefined,
});

const asParams = (filters: StaffJobFilters): ListQueryParams =>
  Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => !!entry[1]),
  );

type ScopedJobsPanelProps = Readonly<{
  scope: JobScopeRef;
  /** Where a job's page is. */
  jobHref: (jobId: string) => string;
}>;

/** The jobs a form's or a workspace's submissions started, for its staff. */
export function ScopedJobsPanel({ scope, jobHref }: ScopedJobsPanelProps) {
  const dict = useDictionary();
  const dictJobs = dict.jobs;
  const router = useRouter();
  const formatDateTime = useFormatLongDateTime();
  const inWorkspace = scope.kind === 'workspace';

  const spec = useMemo(
    () =>
      scope.kind === 'form'
        ? scopedListQuery(FORM_JOBS_LIST_QUERY, scope.formId)
        : scopedListQuery(WORKSPACE_JOBS_LIST_QUERY, scope.workspaceId),
    [scope],
  );
  const query = useListQuery(spec);
  const forms = useJobForms(inWorkspace ? scope.workspaceId : null);
  const formIds = useMemo(
    () => (forms ? new Set(forms.map((form) => form.id)) : undefined),
    [forms],
  );
  const filters = useMemo(
    () => toFilters(query.filters, scope, formIds),
    [query.filters, scope, formIds],
  );
  const jobs = useScopedJobs(scope, filters, {
    offset: query.offset,
    limit: query.pageSize,
    sort: query.sort,
  });
  const { table } = useDataTable(query, jobs, dictJobs.loadError);

  const { setFilters } = query;
  // A filter the fields do not offer reads as none; drop it so the URL and the fields agree.
  const accepted = useMemo(() => asParams(filters), [filters]);
  const dropped = Object.keys(query.filters).length !== Object.keys(accepted).length;
  useEffect(() => {
    if (dropped) setFilters(accepted);
  }, [dropped, accepted, setFilters]);

  const choose = (name: keyof StaffJobFilters) => (key: Key | null) => {
    const value = key?.toString() ?? ALL;
    setFilters(asParams({ ...filters, [name]: value === ALL ? undefined : value }));
  };

  const statusOptions = useMemo(
    () => [
      { id: ALL, label: dictJobs.allStatuses },
      ...JOB_STATUSES.map((value) => ({ id: value, label: dictJobs.statuses[value] })),
    ],
    [dictJobs.allStatuses, dictJobs.statuses],
  );
  const typeOptions = useMemo(
    () => [
      { id: ALL, label: dictJobs.allTypes },
      ...submissionJobTypes().map((type) => ({ id: type, label: jobTypeLabel(type, dict).text })),
    ],
    [dict, dictJobs.allTypes],
  );
  const formOptions = useMemo(
    () => [
      { id: ALL, label: dictJobs.allForms },
      ...(forms ?? []).map((form) => ({ id: form.id, label: form.name })),
    ],
    [forms, dictJobs.allForms],
  );

  const openJob = useCallback(
    (job: StaffJobListItem) => router.push(jobHref(job.id)),
    [router, jobHref],
  );

  const columns: Column<StaffJobListItem>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        label: dictJobs.columns.created,
        sortField: 'createdAt',
        sortDefaultDirection: 'desc',
        render: (job) => (
          <RowActionButton
            main
            aria-label={fillTemplate(dictJobs.viewLabel, {
              type: jobTypeLabel(job.type, dict).text,
              created: formatDateTime(job.createdAt),
            })}
            data-testid={`job-link-${job.id}`}
            onPress={() => openJob(job)}
          >
            {formatDateTime(job.createdAt)}
          </RowActionButton>
        ),
      },
      {
        key: 'type',
        label: dictJobs.columns.type,
        render: (job) => {
          const label = jobTypeLabel(job.type, dict);
          return <span lang={label.lang}>{label.text}</span>;
        },
      },
      {
        key: 'status',
        label: dictJobs.columns.status,
        render: (job) => (
          <StatusTag
            label={dictJobs.statuses[job.status]}
            variant={jobStatusVariant(job.status)}
            data-testid={`job-status-${job.id}`}
          />
        ),
      },
      {
        key: 'attempts',
        label: dictJobs.columns.attempts,
        render: (job) =>
          fillTemplate(dictJobs.attemptsValue, {
            attempts: String(job.attempts),
            max: String(job.maxAttempts),
          }),
      },
      ...(inWorkspace
        ? [
            {
              key: 'form',
              label: dictJobs.columns.form,
              render: (job: StaffJobListItem) => job.formName ?? dict.general.unknown,
            },
          ]
        : []),
      {
        key: 'submission',
        label: dictJobs.columns.submission,
        render: (job) => job.confirmationCode ?? '—',
      },
      {
        key: 'finishedAt',
        label: dictJobs.columns.finished,
        sortField: 'finishedAt',
        sortDefaultDirection: 'desc',
        render: (job) => (job.finishedAt ? formatDateTime(job.finishedAt) : '—'),
      },
      {
        key: 'lastError',
        label: dictJobs.columns.lastError,
        render: (job) =>
          job.lastError ? (
            <span lang="en" title={job.lastError}>
              {job.lastError.length > ERROR_PREVIEW_LENGTH
                ? `${job.lastError.slice(0, ERROR_PREVIEW_LENGTH)}…`
                : job.lastError}
            </span>
          ) : (
            '—'
          ),
      },
    ],
    [dict, dictJobs, inWorkspace, formatDateTime, openJob],
  );

  return (
    <div className={styles.tabContent}>
      <p className={styles.intro}>{inWorkspace ? dictJobs.workspaceIntro : dictJobs.formIntro}</p>
      <div className="d-flex align-items-end gap-3 flex-wrap mb-3">
        {/* The design system replaces its own root class when given one, so the width sits on a
            wrapper. */}
        <div className={styles.filterSelect}>
          <Select
            size="medium"
            label={dictJobs.statusFilter}
            items={statusOptions}
            selectedKey={filters.status ?? ALL}
            onSelectionChange={choose('status')}
            data-testid="jobs-status-filter"
          />
        </div>
        <div className={styles.filterSelect}>
          <Select
            size="medium"
            label={dictJobs.typeFilter}
            items={typeOptions}
            selectedKey={filters.type ?? ALL}
            onSelectionChange={choose('type')}
            data-testid="jobs-type-filter"
          />
        </div>
        {inWorkspace ? (
          <div className={styles.filterSelect}>
            <Select
              size="medium"
              label={dictJobs.formFilter}
              items={formOptions}
              selectedKey={filters.formId ?? ALL}
              onSelectionChange={choose('formId')}
              data-testid="jobs-form-filter"
            />
          </div>
        ) : null}
        <Button variant="secondary" onPress={query.clear} data-testid="jobs-clear-filters">
          {dict.general.clearFilters}
        </Button>
      </div>
      <DataTable<StaffJobListItem>
        {...table}
        columns={columns}
        emptyMessage={dictJobs.empty}
        loadingMessage={dict.general.loading}
        itemName={dictJobs.itemName}
        caption={dictJobs.heading}
        keyExtractor={(job) => job.id}
      />
    </div>
  );
}
