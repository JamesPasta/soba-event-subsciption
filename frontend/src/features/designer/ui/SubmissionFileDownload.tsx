'use client';

import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Link } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { FileDownload } from '@/src/shared/ui/FileDownload';
import { submissionFileLoader } from '@/src/features/designer/data/submissionFile';
import { getLocaleFromPath } from '@/src/shared/util/locale';

type SubmissionFileDownloadProps = {
  formId: string;
  submissionId: string;
  fileId: string;
};

/** Saves a submission's attachment, for staff. */
export function SubmissionFileDownload({
  formId,
  submissionId,
  fileId,
}: Readonly<SubmissionFileDownloadProps>) {
  const dict = useDictionary();
  const router = useRouter();
  const locale = getLocaleFromPath(usePathname());
  const load = useMemo(() => submissionFileLoader(submissionId, fileId), [submissionId, fileId]);

  return (
    <div className="mt-3">
      <Link
        data-testid="submission-file-back"
        onPress={() => router.push(`/${locale}/build/${formId}/submissions/${submissionId}`)}
      >
        {dict.submission.backToSubmission}
      </Link>
      <FileDownload load={load} />
    </div>
  );
}
