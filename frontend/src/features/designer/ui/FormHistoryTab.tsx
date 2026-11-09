'use client';

import { useMemo, useCallback } from 'react';
import { Link } from '@bcgov/design-system-react-components';

import type { Dictionary } from '@/src/types/dictionary';
import { Tag, TagColor } from '@/src/components/Tag';
import { DataTable, type Column } from '@/src/components/DataTable';
import { useFormatLongDate } from '@/src/shared/hooks/useFormatLongDate';
import { FORM_VERSIONS_LIST_QUERY } from '@/src/shared/list/listQueryMemory';
import { useListQuery } from '@/src/shared/list/useListQuery';
import { useDataTable } from '@/src/shared/list/useDataTable';
import { useFormVersionPage } from '../data/useFormVersions';
import type { SobaFormVersionListItem } from '@/src/types/forms';
import { capitalizeFirstLetter } from '@/src/shared/util/stringUtils';

interface FormHistoryTabProps {
  dict: Dictionary;
  formId?: string;
  onSelectVersion: (versionId: string) => void;
  onRestoreVersion: (version: SobaFormVersionListItem) => Promise<boolean>;
  onNavigateToDesigner?: () => void;
}

function stateToColour(state: string): TagColor {
  if (state === 'published') return 'green';
  return 'grey';
}

export default function FormHistoryTab({
  dict,
  formId,
  onSelectVersion,
  onRestoreVersion,
  onNavigateToDesigner,
}: Readonly<FormHistoryTabProps>) {
  const query = useListQuery(FORM_VERSIONS_LIST_QUERY);
  const versionsResult = useFormVersionPage(formId, {
    offset: query.offset,
    limit: query.pageSize,
    sort: query.sort,
  });
  const { table } = useDataTable(query, versionsResult, dict.form.loadVersionsError);
  const formatLongDate = useFormatLongDate();

  const openInDesigner = useCallback(
    (version: SobaFormVersionListItem) => {
      onSelectVersion(version.id);
      onNavigateToDesigner?.();
    },
    [onSelectVersion, onNavigateToDesigner],
  );

  const restore = useCallback(
    (version: SobaFormVersionListItem) => {
      // A restore that failed leaves the designer on the old draft, so staying put is the honest
      // result. The caller reports the failure.
      void onRestoreVersion(version)
        .then((created) => {
          if (created) onNavigateToDesigner?.();
        })
        .catch(() => undefined);
    },
    [onRestoreVersion, onNavigateToDesigner],
  );

  const columns: Column<SobaFormVersionListItem>[] = useMemo(
    () => [
      {
        key: 'versionNo',
        label: dict?.general?.version || 'Version',
        sortField: 'versionNo',
        width: '10%',
      },
      {
        key: 'state',
        label: dict.form?.status || 'Status',
        sortField: 'state',
        render: (version: SobaFormVersionListItem) => (
          <Tag
            data-testid={`${version.id}-status-tag`}
            text={capitalizeFirstLetter(version.state)}
            color={stateToColour(version.state)}
          />
        ),
      },
      {
        key: 'createdBy',
        label: dict.submission?.formList?.columns?.createdBy || 'Created By',
      },
      {
        key: 'created',
        label: dict.submission?.formList?.columns?.createdAt || 'Created Date',
        sortField: 'createdAt',
        render: (version: SobaFormVersionListItem) => (
          <span className="small" data-testid={`${version.id}-created-date`}>
            {formatLongDate(version.createdAt)}
          </span>
        ),
      },
      {
        key: 'actions',
        label: dict.submission?.formList?.columns?.quickLinks || 'Quick Links',
        align: 'start',
        width: '10%',
        render: (version: SobaFormVersionListItem) => (
          <>
            <Link
              className="bcds-react-aria-Link medium false me-2"
              data-testid={`${version.id}-design-link`}
              onPress={() => openInDesigner(version)}
            >
              {dict.header.design}
            </Link>
            <Link
              className="bcds-react-aria-Link medium false me-2"
              data-testid={`${version.id}-newVersionFrom-link`}
              onPress={() => restore(version)}
            >
              {dict.form.newVersionFrom}
            </Link>
          </>
        ),
      },
    ],
    [dict, formatLongDate, openInDesigner, restore],
  );

  return (
    <DataTable<SobaFormVersionListItem>
      {...table}
      columns={columns}
      emptyMessage={dict.form.emptyHistory}
      loadingMessage={dict.general.loading}
      itemName="items"
      caption={dict.form.historyTab}
      keyExtractor={(version) => version.id}
    />
  );
}
