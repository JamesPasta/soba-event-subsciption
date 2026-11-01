'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DateValue } from 'react-aria-components';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  DatePicker,
  Form,
  InlineAlert,
  Link,
  Radio,
  RadioGroup,
  Select,
  TextField,
} from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useDictionary } from '@/app/[lang]/Providers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { usePageHeading, usePageNotices } from '@/src/components/PageHeader';
import { SecondaryText } from '@/src/components/SecondaryText';
import { LoadErrorAlert } from '@/src/shared/ui/LoadErrorAlert';
import { apiErrorMessage } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults, useDataErrorNotice } from '@/src/shared/api/useDataErrorNotice';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import { fillTemplate } from '@/src/shared/util/stringUtils';
import {
  useExportFields,
  useExportForm,
  useSubmissionExportStarter,
} from '@/src/features/designer/data/useSubmissionExport';
import {
  SUBMISSION_EXPORT_LAYOUTS,
  SUBMISSION_EXPORT_MAX_FIELD_LENGTH,
  SUBMISSION_EXPORT_MAX_FIELDS,
  type SubmissionExportFieldsBody,
  type SubmissionExportFormat,
  type SubmissionExportLayout,
} from '@/src/types/submissionExport';
import { SubmissionExportList } from './SubmissionExportList';

const ALL_VERSIONS = 'all';

type DateMode = 'all' | 'range';

/** Whether the start route accepts these field names. */
const startAcceptsNames = (fields: string[]) =>
  fields.length <= SUBMISSION_EXPORT_MAX_FIELDS &&
  fields.every((field) => field.length <= SUBMISSION_EXPORT_MAX_FIELD_LENGTH);

/** Today as local YYYY-MM-DD. */
const localToday = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Start of a local day, as an ISO instant. */
const dayStart = (day: DateValue) => new Date(`${day.toString()}T00:00:00`).toISOString();

/** The CHEFS 1 export screen plus versions, and the reader's exports with their files. */
export function SubmissionExport({ formId }: Readonly<{ formId: string }>) {
  const dict = useDictionary();
  const text = dict.submission.export;
  const authDefaults = useAuthErrorDefaults();
  const notifyError = useDataErrorNotice();
  const router = useRouter();
  const locale = useSortLocale();
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();

  const form = useExportForm(formId);
  const starter = useSubmissionExportStarter(formId);
  usePageHeading({ heading: text.pageTitle, eyebrow: form.data?.name });
  // Placeholder: says the CSV formats are not applied yet.
  usePageNotices([{ id: 'submission-export-sample', variant: 'info', body: text.sampleNotice }]);

  const [format, setFormat] = useState<SubmissionExportFormat>('csv');
  const [versionId, setVersionId] = useState(ALL_VERSIONS);
  const [dateMode, setDateMode] = useState<DateMode>('all');
  // Kept while another date choice is made, and sent only with "Date range".
  const [from, setFrom] = useState<DateValue | null>(null);
  const [to, setTo] = useState<DateValue | null>(null);
  const [layout, setLayout] = useState<SubmissionExportLayout>(SUBMISSION_EXPORT_LAYOUTS[0]);
  const [search, setSearch] = useState('');
  // Unticked fields; new fields start ticked.
  const [unticked, setUnticked] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);

  const isCsv = format === 'csv';
  const isRange = dateMode === 'range';
  const rangeChosen = !!from && !!to;
  const rangeValid = rangeChosen && from.compare(to) <= 0 && to.toString() <= localToday();

  // Only what a visible control sets. To is inclusive on screen, so the bound is the next day.
  const filters: SubmissionExportFieldsBody | null = useMemo(() => {
    if (isRange && !rangeValid) return null;
    return {
      formVersionId: versionId === ALL_VERSIONS ? undefined : versionId,
      from: isRange ? dayStart(from!) : undefined,
      to: isRange ? dayStart(to!.add({ days: 1 })) : undefined,
      layout: isCsv ? layout : undefined,
    };
  }, [versionId, isRange, rangeValid, from, to, isCsv, layout]);
  const fields = useExportFields(formId, filters);

  const allFields = fields.data?.fields ?? [];
  const selected = allFields.filter((field) => !unticked.includes(field));
  const needle = search.trim().toLowerCase();
  const shown = allFields.filter((field) => field.toLowerCase().includes(needle));
  // The unformatted layout writes every field.
  const picksFields = isCsv && layout !== 'unFormattedCSVExport';

  const backToSubmissions = () => router.push(`/${locale}/build/${formId}?tab=submissions`);

  const tickShown = (values: string[]) =>
    setUnticked((prev) => [
      ...prev.filter((field) => !shown.includes(field)),
      ...shown.filter((field) => !values.includes(field)),
    ]);

  const tickAllShown = () => setUnticked((prev) => prev.filter((field) => !shown.includes(field)));
  const untickAllShown = () => setUnticked((prev) => [...new Set([...prev, ...shown])]);

  // The choices stay as they are either way; they are filters, not a draft.
  const runStart = async () => {
    if (!filters) return;
    if (!token) {
      addNotification({ text: dict.general.sessionExpired, type: 'error' });
      return;
    }
    setStarting(true);
    try {
      await starter.start(token, {
        ...filters,
        format,
        // Absent means all, for when the start route would refuse all of them by name.
        fields:
          picksFields && (selected.length < allFields.length || startAcceptsNames(selected))
            ? selected
            : undefined,
      });
      addNotification({ text: text.started, type: 'success' });
    } catch (cause: unknown) {
      const limited = apiErrorMessage(cause, {
        export_limit_reached: dict.apiErrors.export_limit_reached,
      });
      if (limited) addNotification({ text: limited, type: 'error' });
      else notifyError(cause, { failed: text.failed });
    } finally {
      setStarting(false);
    }
  };

  // No fields while the read for the current filters runs, so an old list is not sent.
  const canStart =
    !!filters &&
    !!fields.data &&
    !starting &&
    allFields.length > 0 &&
    (!picksFields || selected.length > 0);

  const versionLabel = (id?: string) => {
    if (!id) return text.allVersions;
    const versionNo = form.data?.versions.find((version) => version.id === id)?.versionNo;
    return fillTemplate(text.versionOption, { version: String(versionNo ?? id) });
  };

  const countText = (count: number) => {
    if (count === 0) return text.submissionCountNone;
    if (count === 1) return text.submissionCountOne;
    return fillTemplate(text.submissionCount, { count: String(count) });
  };

  const renderFields = () => {
    if (fields.error) {
      return (
        <LoadErrorAlert
          error={fields.error}
          messages={{ ...authDefaults, failed: text.fieldsError }}
          testIds={{ failed: 'export-fields-loaderror' }}
        />
      );
    }
    if (!filters) return null;
    if (!fields.data) return <CenteredProgress label={dict.general.loading} />;
    if (allFields.length === 0) {
      return (
        <InlineAlert variant="info" data-testid="export-no-fields">
          {text.noFields}
        </InlineAlert>
      );
    }
    if (!picksFields) return null;
    return (
      <div className="d-flex flex-column gap-2" data-testid="export-fields">
        <TextField
          label={text.fieldSearch}
          value={search}
          onChange={setSearch}
          onKeyDown={(event) => {
            // Enter would otherwise start an export.
            if (event.key === 'Enter') event.preventDefault();
            else event.continuePropagation();
          }}
          data-testid="export-field-search"
        />
        <div className="d-flex gap-2 align-items-center">
          <Button
            variant="tertiary"
            size="small"
            onPress={tickAllShown}
            data-testid="export-fields-all"
          >
            {text.selectAll}
          </Button>
          <Button
            variant="tertiary"
            size="small"
            onPress={untickAllShown}
            data-testid="export-fields-none"
          >
            {text.selectNone}
          </Button>
          <SecondaryText data-testid="export-fields-count">
            {fillTemplate(text.fieldsSelected, {
              selected: String(selected.length),
              total: String(allFields.length),
            })}
          </SecondaryText>
        </div>
        <CheckboxGroup
          label={text.fields}
          value={selected.filter((field) => shown.includes(field))}
          onChange={tickShown}
          isDisabled={starting}
          data-testid="export-field-list"
        >
          {shown.map((field) => (
            <Checkbox key={field} value={field} data-testid={`export-field-${field}`}>
              {field}
            </Checkbox>
          ))}
        </CheckboxGroup>
      </div>
    );
  };

  const renderForm = () => {
    if (form.error) {
      return (
        <LoadErrorAlert
          error={form.error}
          messages={{ ...authDefaults, failed: text.loadError }}
          testIds={{ failed: 'export-form-loaderror' }}
        />
      );
    }
    if (!form.data) return <CenteredProgress label={dict.general.loading} />;
    const versionItems = [
      { id: ALL_VERSIONS, label: text.allVersions },
      // A draft has no submissions to export.
      ...form.data.versions
        .filter((version) => version.state !== 'draft')
        .sort((a, b) => b.versionNo - a.versionNo)
        .map((version) => ({ id: version.id, label: versionLabel(version.id) })),
    ];
    return (
      <Form
        className="d-flex flex-column gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void runStart();
        }}
        data-testid="export-form"
      >
        <RadioGroup
          label={text.fileType}
          value={format}
          onChange={(value) => setFormat(value as SubmissionExportFormat)}
          isDisabled={starting}
          data-testid="export-format"
        >
          <Radio value="csv" data-testid="export-format-csv">
            {text.csv}
          </Radio>
          <Radio value="json" data-testid="export-format-json">
            {text.json}
          </Radio>
        </RadioGroup>
        <div data-testid="export-version">
          <Select
            size="medium"
            id="export-version-select"
            label={text.version}
            selectedKey={versionId}
            onSelectionChange={(key) => setVersionId(String(key))}
            items={versionItems}
            isDisabled={starting}
          />
        </div>
        <RadioGroup
          label={text.dates}
          value={dateMode}
          onChange={(value) => setDateMode(value as DateMode)}
          isDisabled={starting}
          data-testid="export-dates"
        >
          <Radio value="all" data-testid="export-dates-all">
            {text.all}
          </Radio>
          <Radio value="range" data-testid="export-dates-range">
            {text.range}
          </Radio>
        </RadioGroup>
        {isRange ? (
          <div className="d-flex gap-3 flex-wrap" data-testid="export-range">
            <DatePicker
              label={text.from}
              isRequired
              value={from}
              onChange={setFrom}
              isInvalid={rangeChosen && !rangeValid}
              errorMessage={text.rangeInvalid}
              isDisabled={starting}
              data-testid="export-from"
            />
            <DatePicker
              label={text.to}
              isRequired
              value={to}
              onChange={setTo}
              isInvalid={rangeChosen && !rangeValid}
              errorMessage={text.rangeInvalid}
              isDisabled={starting}
              data-testid="export-to"
            />
          </div>
        ) : null}
        {isCsv ? (
          <RadioGroup
            label={text.layout}
            value={layout}
            onChange={(value) => setLayout(value as SubmissionExportLayout)}
            isDisabled={starting}
            data-testid="export-layout"
          >
            {SUBMISSION_EXPORT_LAYOUTS.map((option) => (
              <Radio key={option} value={option} data-testid={`export-layout-${option}`}>
                {text.layouts[option]}
              </Radio>
            ))}
          </RadioGroup>
        ) : null}
        {renderFields()}
        {fields.data ? (
          <SecondaryText data-testid="export-submission-count">
            {countText(fields.data.count)}
          </SecondaryText>
        ) : null}
        <div>
          <Button
            type="submit"
            variant="primary"
            isDisabled={!canStart}
            data-testid="export-submit"
          >
            {starting ? text.starting : text.start}
          </Button>
        </div>
      </Form>
    );
  };

  return (
    <div className="mt-3" data-testid="submission-export">
      <div className="mb-3">
        <Link onPress={backToSubmissions} data-testid="export-back">
          {text.back}
        </Link>
      </div>
      {renderForm()}
      <div className="mt-4" data-testid="export-list">
        <SubmissionExportList formId={formId} versionLabel={versionLabel} />
      </div>
    </div>
  );
}
