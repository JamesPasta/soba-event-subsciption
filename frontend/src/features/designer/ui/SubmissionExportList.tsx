'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { DataTable, type Column } from '@/src/components/DataTable';
import { SecondaryText } from '@/src/components/SecondaryText';
import { StatusTag, type StatusTagVariant } from '@/src/components/StatusTag';
import { isConflict } from '@/src/shared/api/dataError';
import { useDataErrorNotice } from '@/src/shared/api/useDataErrorNotice';
import { useFormatLongDateTime } from '@/src/shared/hooks/useFormatLongDate';
import { SUBMISSION_EXPORTS_LIST_QUERY, scopedListQuery } from '@/src/shared/list/listQueryMemory';
import { useDataTable } from '@/src/shared/list/useDataTable';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useSortLocale } from '@/src/shared/list/useSortLocale';
import { formatFileSize } from '@/src/shared/util/fileSize';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { fillTemplate } from '@/src/shared/util/stringUtils';
import {
  useSubmissionExports,
  useSubmissionExportStopper,
} from '@/src/features/designer/data/useSubmissionExport';
import {
  isActiveExportStatus,
  type SubmissionExport,
  type SubmissionExportStatus,
} from '@/src/types/submissionExport';

const STATUS_VARIANTS: Record<SubmissionExportStatus, StatusTagVariant> = {
  queued: 'neutral',
  running: 'info',
  ready: 'success',
  expired: 'neutral',
  failed: 'warning',
  cancelled: 'neutral',
};

// The time to the minute, so a ready file reads as expired once its time passes with the page open.
const MINUTE_MS = 60_000;
const everyMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(timer);
};
const currentMinute = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
const serverMinute = () => 0;

/** A ready file past its expiry reads as expired, though the list was read before it passed. */
const shownStatus = (item: SubmissionExport, now: number): SubmissionExportStatus =>
  item.status === 'ready' && item.result && Date.parse(item.result.expiresAt) <= now
    ? 'expired'
    : item.status;

type SubmissionExportListProps = Readonly<{
  formId: string;
  /** The form version an export covers, as the reader names it. */
  versionLabel: (versionId?: string) => string;
}>;

/** The reader's latest exports of the form: where each stands, its file, and Stop export. */
export function SubmissionExportList({ formId, versionLabel }: SubmissionExportListProps) {
  const dict = useDictionary();
  const text = dict.submission.export;
  const notifyError = useDataErrorNotice();
  const formatDateTime = useFormatLongDateTime();
  const locale = getLocaleFromPath(usePathname());
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const listSpec = useMemo(() => scopedListQuery(SUBMISSION_EXPORTS_LIST_QUERY, formId), [formId]);
  const query = useListQuery(listSpec);
  const exports = useSubmissionExports(formId, {
    offset: query.offset,
    limit: query.pageSize,
    sort: query.sort,
  });
  const { table } = useDataTable(query, exports, text.listError);
  const { stop } = useSubmissionExportStopper(formId);
  const [stopping, setStopping] = useState<SubmissionExport | null>(null);
  const [pending, setPending] = useState(false);
  const now = useSyncExternalStore(everyMinute, currentMinute, serverMinute);
  const sortLocale = useSortLocale();

  // The stop button goes once the stop is asked for, so focus moves to the export's status.
  const focusStatus = (exportId: string) =>
    requestAnimationFrame(() => document.getElementById(`export-status-${exportId}`)?.focus());

  const runStop = async () => {
    const item = stopping;
    if (!item) return;
    if (!token) {
      addNotification({ text: dict.general.sessionExpired, type: 'error' });
      return;
    }
    setPending(true);
    try {
      const outcome = await stop(token, item.id);
      const stopped = outcome.status === 'applied' && outcome.value.stopped;
      addNotification({ text: stopped ? text.stopped : text.stopRequested, type: 'success' });
    } catch (cause: unknown) {
      if (isConflict(cause)) {
        addNotification({ text: text.stopFinished, type: 'info' });
        await exports.refresh();
      } else {
        notifyError(cause, { failed: text.stopError });
      }
    } finally {
      setPending(false);
      setStopping(null);
      focusStatus(item.id);
    }
  };

  // While it runs: how far it has got, and whether a stop is on its way.
  const activeLines = (item: SubmissionExport, status: SubmissionExportStatus): string[] => {
    if (!isActiveExportStatus(status)) return [];
    const lines: string[] = [];
    if (status === 'running' && item.progress) {
      lines.push(
        item.progress.total === null
          ? String(item.progress.done)
          : fillTemplate(text.progressValue, {
              done: String(item.progress.done),
              total: String(item.progress.total),
            }),
      );
    }
    if (item.cancelRequestedAt) lines.push(text.stopping);
    return lines;
  };

  // Once it ended: its file and how long it is kept, or why it ended.
  const endedLines = (item: SubmissionExport, status: SubmissionExportStatus): string[] => {
    if (status === 'ready' && item.result) {
      const until = fillTemplate(text.readyUntil, {
        expires: formatDateTime(item.result.expiresAt),
      });
      return item.result.size == null
        ? [until]
        : [until, formatFileSize(item.result.size, sortLocale)];
    }
    if (status === 'expired' && item.result) {
      return [fillTemplate(text.expiredOn, { expires: formatDateTime(item.result.expiresAt) })];
    }
    if ((status === 'failed' || status === 'cancelled') && item.endReason) {
      return [text.endReasons[item.endReason]];
    }
    return [];
  };

  const unreadLines = (item: SubmissionExport): string[] => {
    if (!item.unreadCount) return [];
    if (item.unreadCount === 1) return [text.unreadOne];
    return [fillTemplate(text.unread, { count: String(item.unreadCount) })];
  };

  const details = (item: SubmissionExport, status: SubmissionExportStatus): string[] => [
    ...activeLines(item, status),
    ...endedLines(item, status),
    ...unreadLines(item),
  ];

  const columns: Column<SubmissionExport>[] = [
    {
      key: 'createdAt',
      label: text.startedAt,
      sortField: 'createdAt',
      render: (item) => formatDateTime(item.createdAt),
    },
    {
      key: 'format',
      label: text.fileType,
      render: (item) => text[item.format],
    },
    {
      key: 'formVersionId',
      label: text.version,
      render: (item) => versionLabel(item.formVersionId),
    },
    {
      key: 'status',
      label: text.status,
      render: (item) => {
        const status = shownStatus(item, now);
        return (
          <span
            id={`export-status-${item.id}`}
            tabIndex={-1}
            className="d-inline-flex flex-column gap-1"
          >
            <StatusTag
              label={text.statuses[status]}
              variant={STATUS_VARIANTS[status]}
              data-testid={`export-status-${item.id}`}
            />
            {details(item, status).map((line) => (
              <SecondaryText key={line} data-testid={`export-detail-${item.id}`}>
                {line}
              </SecondaryText>
            ))}
          </span>
        );
      },
    },
    {
      key: 'id',
      label: text.actions,
      render: (item) => {
        const status = shownStatus(item, now);
        const started = formatDateTime(item.createdAt);
        if (status === 'ready') {
          // Next's Link, which adds the base path the app is served under.
          return (
            <Link
              href={`/${locale}/build/${formId}/submissions/exports/${item.id}/file`}
              aria-label={fillTemplate(text.downloadLabel, { started })}
              data-testid={`export-download-${item.id}`}
            >
              {text.download}
            </Link>
          );
        }
        if (isActiveExportStatus(status) && !item.cancelRequestedAt) {
          return (
            <Button
              variant="tertiary"
              size="small"
              aria-label={fillTemplate(text.stopLabel, { started })}
              onPress={() => setStopping(item)}
              data-testid={`export-stop-${item.id}`}
            >
              {text.stop}
            </Button>
          );
        }
        return null;
      },
    },
  ];

  // A list never read shows its error in the table; a failed read again keeps the rows and says so
  // once, as every server-paged table does.
  return (
    <div className="d-flex flex-column gap-2">
      <SecondaryText elementType="p" data-testid="export-list-note">
        {text.listNote}
      </SecondaryText>
      <DataTable<SubmissionExport>
        {...table}
        columns={columns}
        caption={text.myExports}
        emptyMessage={text.noExports}
        loadingMessage={dict.general.loading}
        itemName={text.itemName}
        keyExtractor={(item) => item.id}
      />
      <ConfirmModal
        show={stopping !== null}
        title={text.stopTitle}
        message={text.stopMessage}
        confirmLabel={text.stop}
        cancelLabel={text.keepRunning}
        pending={pending}
        onConfirm={() => void runStop()}
        onCancel={() => setStopping(null)}
      />
    </div>
  );
}
