'use client';

import { useCallback, useEffect, useMemo, useState, type Key } from 'react';
import { Button, Form, Select, TextField } from '@bcgov/design-system-react-components';
import { JOB_STATUSES } from '@soba/lib';
import { usePathname, useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/src/components/DataTable';
import { RowActionButton } from '@/src/components/RowActionButton';
import { StatusTag } from '@/src/components/StatusTag';
import { useDictionary } from '@/app/[lang]/Providers';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { fillTemplate } from '@/src/shared/util/stringUtils';
import { useFormatLongDateTime } from '@/src/shared/hooks/useFormatLongDate';
import { JOBS_LIST_QUERY, type ListQueryParams } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import type { JobFilters, JobListItem } from '@/src/types/admin';
import { useJobs, useJobTypes } from '../data/useAdminData';
import { isUuid } from '@/src/shared/util/uuid';
import { jobStatusVariant, jobTypeLabel, toJobStatus } from '@/src/features/jobs/jobs';
import styles from './AdminPanel.module.css';

const ALL = 'all';
const ERROR_PREVIEW_LENGTH = 80;
const ID_FIELDS = ['workspaceId', 'formId', 'submissionId'] as const;

const toId = (raw: string | undefined): string | undefined =>
  raw && isUuid(raw) ? raw : undefined;

/** The filters the URL holds that the API accepts; anything else is dropped. */
const toJobFilters = (params: ListQueryParams): JobFilters => ({
  status: toJobStatus(params.status),
  type: params.type?.trim() || undefined,
  workspaceId: toId(params.workspaceId),
  formId: toId(params.formId),
  submissionId: toId(params.submissionId),
});

const asParams = (filters: JobFilters): ListQueryParams =>
  Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => !!entry[1]),
  );

const filtersKey = (filters: JobFilters): string => JSON.stringify(asParams(filters));

/** The fields as typed, before Search. */
type Draft = Record<'status' | 'type' | (typeof ID_FIELDS)[number], string>;

const draftOf = (filters: JobFilters): Draft => ({
  status: filters.status ?? ALL,
  type: filters.type ?? ALL,
  workspaceId: filters.workspaceId ?? '',
  formId: filters.formId ?? '',
  submissionId: filters.submissionId ?? '',
});

const filtersOf = (draft: Draft): JobFilters => ({
  status: toJobStatus(draft.status),
  type: draft.type === ALL ? undefined : draft.type,
  workspaceId: draft.workspaceId.trim() || undefined,
  formId: draft.formId.trim() || undefined,
  submissionId: draft.submissionId.trim() || undefined,
});

type JobFilterFormProps = Readonly<{
  filters: JobFilters;
  typeOptions: { id: string; label: string }[];
  onSearch: (filters: JobFilters) => void;
  onClear: () => void;
}>;

/**
 * The list reads the fields only on Search. The fields stay enabled while it loads: a control that
 * is disabled under the pointer drops keyboard focus.
 */
function JobFilterForm({ filters, typeOptions, onSearch, onClear }: JobFilterFormProps) {
  const dict = useDictionary();
  const dictJobs = dict.jobs;
  const dictAdmin = dict.admin.jobs;
  const [draft, setDraft] = useState(() => draftOf(filters));
  // The URL filters the fields last showed. A change from elsewhere, such as Back or a link,
  // reseeds them; the form's own Search and Reset do not, so the form keeps focus.
  const [shownKey, setShownKey] = useState(() => filtersKey(filters));
  const urlKey = filtersKey(filters);
  if (urlKey !== shownKey) {
    setShownKey(urlKey);
    setDraft(draftOf(filters));
  }

  const set = (field: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const invalid = (value: string) => value.trim() !== '' && !isUuid(value.trim());
  const valid = ID_FIELDS.every((field) => !invalid(draft[field]));

  const statusOptions = useMemo(
    () => [
      { id: ALL, label: dictJobs.allStatuses },
      ...JOB_STATUSES.map((value) => ({ id: value, label: dictJobs.statuses[value] })),
    ],
    [dictJobs.allStatuses, dictJobs.statuses],
  );

  const labels: Record<(typeof ID_FIELDS)[number], string> = {
    workspaceId: dictAdmin.workspaceIdLabel,
    formId: dictAdmin.formIdLabel,
    submissionId: dictAdmin.submissionIdLabel,
  };

  return (
    <Form
      className="d-flex align-items-start gap-3 flex-wrap mb-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        const next = filtersOf(draft);
        setShownKey(filtersKey(next));
        onSearch(next);
      }}
    >
      {/* The design system replaces its own root class when given one, so the width sits on a
          wrapper. */}
      <div className={styles.filterSelect}>
        <Select
          size="medium"
          label={dictJobs.statusFilter}
          items={statusOptions}
          selectedKey={draft.status}
          onSelectionChange={(key: Key | null) => set('status')(key?.toString() ?? ALL)}
          data-testid="jobs-status-filter"
        />
      </div>
      <div className={styles.filterSelect}>
        <Select
          size="medium"
          label={dictJobs.typeFilter}
          items={[{ id: ALL, label: dictJobs.allTypes }, ...typeOptions]}
          selectedKey={draft.type}
          onSelectionChange={(key: Key | null) => set('type')(key?.toString() ?? ALL)}
          data-testid="jobs-type-filter"
        />
      </div>
      {ID_FIELDS.map((field) => (
        <TextField
          key={field}
          label={labels[field]}
          value={draft[field]}
          onChange={set(field)}
          isInvalid={invalid(draft[field])}
          errorMessage={dictAdmin.invalidId}
          data-testid={`jobs-${field}-filter`}
        />
      ))}
      <div className="d-flex gap-2 align-self-end">
        <Button type="submit" variant="primary" isDisabled={!valid} data-testid="jobs-search">
          {dict.general.search}
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            setDraft(draftOf({}));
            setShownKey(filtersKey({}));
            onClear();
          }}
          data-testid="jobs-clear-filters"
        >
          {dict.general.clearFilters}
        </Button>
      </div>
    </Form>
  );
}

/** Every workspace's background jobs, for platform administrators. */
export function JobsPanel() {
  const dict = useDictionary();
  const dictJobs = dict.jobs;
  const dictAdmin = dict.admin.jobs;
  const router = useRouter();
  const locale = getLocaleFromPath(usePathname());
  const formatDateTime = useFormatLongDateTime();
  const types = useJobTypes();

  const query = useListQuery(JOBS_LIST_QUERY);
  const filters = useMemo(() => toJobFilters(query.filters), [query.filters]);
  const jobs = useJobs(filters, { offset: query.offset, limit: query.pageSize, sort: query.sort });
  const { table } = useDataTable(query, jobs, dictJobs.loadError);

  const { setFilters } = query;
  // A filter the API would refuse reads as none; drop it so the URL and the fields agree.
  const accepted = useMemo(() => asParams(filters), [filters]);
  const dropped = Object.keys(query.filters).length !== Object.keys(accepted).length;
  useEffect(() => {
    if (dropped) setFilters(accepted);
  }, [dropped, accepted, setFilters]);

  const typeLabel = useCallback((type: string) => jobTypeLabel(type, dict, types), [dict, types]);

  const typeOptions = useMemo(
    () => types.map((item) => ({ id: item.type, label: typeLabel(item.type).text })),
    [types, typeLabel],
  );

  const openJob = useCallback(
    (job: JobListItem) => router.push(`/${locale}/admin/jobs/${job.id}`),
    [router, locale],
  );

  const columns: Column<JobListItem>[] = useMemo(
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
              type: typeLabel(job.type).text,
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
          const label = typeLabel(job.type);
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
      {
        // Names only: the ids would wrap over several lines. The job's page shows them.
        key: 'workspace',
        label: dictAdmin.columns.workspace,
        render: (job) => job.workspaceName,
      },
      {
        key: 'form',
        label: dictJobs.columns.form,
        render: (job) => (job.formId ? (job.formName ?? dict.general.unknown) : '—'),
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
    [
      dictJobs,
      dictAdmin.columns.workspace,
      dict.general.unknown,
      typeLabel,
      formatDateTime,
      openJob,
    ],
  );

  const handleSearch = useCallback((next: JobFilters) => setFilters(asParams(next)), [setFilters]);

  return (
    <div className={styles.tabContent}>
      <p className={styles.panelIntro}>{dictAdmin.intro}</p>
      <JobFilterForm
        filters={filters}
        typeOptions={typeOptions}
        onSearch={handleSearch}
        onClear={query.clear}
      />
      <DataTable<JobListItem>
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
