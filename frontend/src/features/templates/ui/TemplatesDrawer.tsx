'use client';

import { useCallback, useMemo, useState } from 'react';
import { Accordion, InlineAlert } from '@bcgov/design-system-react-components';

import type { TemplateResponse } from '@/src/types/templates';
import { DataTable, type Column } from '@/src/components/DataTable';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { RowActionButton } from '@/src/components/RowActionButton';
import { useFormatLongDate } from '@/src/shared/hooks/useFormatLongDate';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { classifyDataError, messageForDataError } from '@/src/shared/api/dataError';
import { useForm } from '@/src/features/designer/data/useForm';
import type { FormSettingsSectionProps } from '@/src/features/form-settings/types';
import { useTemplates } from '../data/useTemplates';
import { useTemplateTypes } from '../data/useTemplateTypes';
import { TemplateUploadForm } from './TemplateUploadForm';

const KB = 1024;

const versionLabel = (template: TemplateResponse) => `v${template.formVersionNo}`;

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < KB) return `${bytes} B`;
  const kb = bytes / KB;
  return kb < KB ? `${Math.round(kb)} KB` : `${(kb / KB).toFixed(1)} MB`;
}

export default function TemplatesDrawer({
  dict,
  drawerName,
  formId,
}: Readonly<FormSettingsSectionProps>) {
  const text = dict.form.templates;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const formatLongDate = useFormatLongDate();
  const { form, currentVersion, versions, versionsTruncated, versionsLimit } = useForm(formId);
  const types = useTemplateTypes(formId, form?.workspaceId ?? null);
  const { templates, isLoading, error, upload, replace, remove, download } = useTemplates(
    formId,
    currentVersion?.id ?? null,
  );

  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TemplateResponse | null>(null);

  const report = useCallback(
    (e: unknown, failedText: string) => {
      addNotification({
        text: messageForDataError(classifyDataError(e), {
          sessionExpired: dict.general.sessionExpired,
          forbidden: dict.general.noAccess,
          failed: failedText,
        }),
        type: 'error',
        consoleError: e,
      });
    },
    [addNotification, dict],
  );

  const confirmDelete = async () => {
    if (!token || !pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await remove(token, pendingDelete.id);
      addNotification({ text: text.deleteSuccess, type: 'success' });
      setPendingDelete(null);
    } catch (e: unknown) {
      report(e, text.deleteError);
    } finally {
      setDeleting(false);
    }
  };

  const startDownload = useCallback(
    (template: TemplateResponse) => {
      if (!token) return;
      void download(token, template).catch((e: unknown) => report(e, text.downloadError));
    },
    [token, download, report, text.downloadError],
  );

  const columns: Column<TemplateResponse>[] = useMemo(
    () => [
      {
        key: 'name',
        label: text.nameColumn,
        render: (template) => (
          <RowActionButton
            main
            data-testid={`template-${template.id}-download`}
            aria-label={`${text.download} ${template.name} ${versionLabel(template)}`}
            onPress={() => startDownload(template)}
          >
            {template.name}
          </RowActionButton>
        ),
      },
      {
        key: 'type',
        label: text.typeColumn,
        render: (template) => (
          <span data-testid={`template-${template.id}-type`}>{text.types[template.type]}</span>
        ),
      },
      {
        key: 'formVersionNo',
        label: text.versionColumn,
        render: (template) => (
          <span data-testid={`template-${template.id}-version`}>{versionLabel(template)}</span>
        ),
      },
      { key: 'filename', label: text.fileColumn },
      {
        key: 'size',
        label: text.sizeColumn,
        align: 'end',
        render: (template) => <span className="small">{formatSize(template.size)}</span>,
      },
      {
        key: 'updatedAt',
        label: text.updatedColumn,
        render: (template) => <span className="small">{formatLongDate(template.updatedAt)}</span>,
      },
      {
        key: 'actions',
        label: text.actionsColumn,
        align: 'end',
        render: (template) => (
          <RowActionButton
            data-testid={`template-${template.id}-delete`}
            aria-label={`${text.delete} ${template.name} ${versionLabel(template)}`}
            onPress={() => setPendingDelete(template)}
          >
            {text.delete}
          </RowActionButton>
        ),
      },
    ],
    [text, formatLongDate, startDownload],
  );

  const loadError = error
    ? messageForDataError(error, {
        sessionExpired: dict.general.sessionExpired,
        forbidden: dict.general.noAccess,
        failed: text.loadError,
      })
    : null;

  return (
    <Accordion id={drawerName} data-testid={`accordion-${drawerName}`} label={text.drawerLabel}>
      <div className="d-block w-100">
        {types?.length === 0 && (
          <InlineAlert variant="info" title={text.noTypes} data-testid="template-no-types" />
        )}
        {types && types.length > 0 && (
          <TemplateUploadForm
            dict={dict}
            types={types}
            templates={templates}
            currentVersion={currentVersion}
            versions={versions}
            versionsTruncated={versionsTruncated}
            versionsLimit={versionsLimit}
            upload={upload}
            replace={replace}
          />
        )}

        <DataTable<TemplateResponse>
          data={templates}
          columns={columns}
          loading={isLoading}
          error={loadError}
          emptyMessage={text.empty}
          caption={text.drawerLabel}
          keyExtractor={(template) => template.id}
        />
      </div>

      <ConfirmModal
        show={pendingDelete !== null}
        title={text.deleteTitle}
        message={text.deleteMessage
          .replace('{name}', pendingDelete?.name ?? '')
          .replace('{version}', pendingDelete ? versionLabel(pendingDelete) : '')}
        confirmLabel={text.delete}
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Accordion>
  );
}
