'use client';

import { useState } from 'react';
import { Button } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { DataTable, type Column } from '@/src/components/DataTable';
import { Modal } from '@/src/components/Modal';

type SubmissionHistoryModalProps<T> = {
  show: boolean;
  title: string;
  intro?: string;
  columns: Column<T>[];
  rows: T[];
  onClose: () => void;
};

/** A history list in a modal, paged in the browser: the whole history is already loaded. */
export function SubmissionHistoryModal<T extends { id: string }>({
  show,
  title,
  intro,
  columns,
  rows,
  onClose,
}: Readonly<SubmissionHistoryModalProps<T>>) {
  const dict = useDictionary();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  return (
    <Modal
      show={show}
      title={title}
      onClose={onClose}
      footer={
        <Button variant="primary" onPress={onClose} data-testid="submission-history-close">
          {dict.submission.review.close}
        </Button>
      }
    >
      {intro ? <p data-testid="submission-history-intro">{intro}</p> : null}
      <DataTable<T>
        data={rows.slice((page - 1) * pageSize, page * pageSize)}
        columns={columns}
        caption={title}
        pageSize={pageSize}
        currentPage={page}
        totalItems={rows.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        keyExtractor={(row) => row.id}
      />
    </Modal>
  );
}
