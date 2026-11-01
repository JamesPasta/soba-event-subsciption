'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDictionary } from '@/app/[lang]/Providers';
import { FileDownload } from '@/src/shared/ui/FileDownload';
import { submissionExportFileLoader } from '@/src/features/designer/data/submissionExportFile';
import { getLocaleFromPath } from '@/src/shared/util/locale';

type SubmissionExportDownloadProps = {
  formId: string;
  exportId: string;
};

/** Saves one of the reader's ready exports. */
export function SubmissionExportDownload({
  formId,
  exportId,
}: Readonly<SubmissionExportDownloadProps>) {
  const dict = useDictionary();
  const text = dict.submission.export;
  const locale = getLocaleFromPath(usePathname());
  const load = useMemo(() => submissionExportFileLoader(formId, exportId), [formId, exportId]);

  return (
    <div className="mt-3">
      <Link href={`/${locale}/build/${formId}/submissions/exports`} data-testid="export-file-back">
        {text.backToExports}
      </Link>
      <FileDownload load={load} notFound={text.fileNotFound} />
    </div>
  );
}
