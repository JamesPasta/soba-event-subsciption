'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Link } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useDictionary } from '@/app/[lang]/Providers';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { usePageHeading } from '@/src/components/PageHeader';
import { SubmissionLoadAlert } from '@/src/features/submissions/ui/SubmissionLoadAlert';
import { useDesignSubmission } from '@/src/features/designer/data/useDesignSubmission';
import { useStaffPrint } from '@/src/features/templates/data/useSubmissionPrint';
import { printBaseName } from '@/src/features/templates/printFileName';
import { PrintSubmissionButton } from '@/src/features/templates/ui/PrintSubmissionButton';
import { useLeaveWarning } from '@/src/shared/hooks/useLeaveWarning';
import { navLink } from '@/src/shared/list/listQueryMemory';
import { SubmissionReview } from './SubmissionReview';
import { getLocaleFromPath } from '@/src/shared/util/locale';

type DesignSubmissionViewProps = {
  formId: string;
  submissionId: string;
};

/** Staff view of one submission, read through the design API. */
export function DesignSubmissionView({
  formId,
  submissionId,
}: Readonly<DesignSubmissionViewProps>) {
  const dict = useDictionary();
  const router = useRouter();
  const locale = getLocaleFromPath(usePathname());

  const { data, error } = useDesignSubmission(submissionId, formId);
  const print = useStaffPrint(formId, submissionId);
  const [unsavedEdit, setUnsavedEdit] = useState(false);
  const [confirmingBack, setConfirmingBack] = useState(false);
  const dictReview = dict.submission.review;

  usePageHeading({ heading: dictReview.heading });
  useLeaveWarning(unsavedEdit);

  const backToList = () => router.push(navLink(`/${locale}/build/${formId}?tab=submissions`));

  const renderContent = () => {
    // A failed background revalidation keeps the submission already on screen.
    if (data) {
      return (
        <SubmissionReview
          submission={data.submission}
          schema={data.schema}
          content={data.content}
          onUnsavedEditChange={setUnsavedEdit}
        />
      );
    }
    if (error) return <SubmissionLoadAlert error={error} />;
    return <CenteredProgress label={dict.general.loading} />;
  };

  return (
    <div className="mt-3" data-testid="design-submission-view">
      <div className="mb-3 d-flex align-items-center gap-2 d-print-none">
        <Link
          data-testid="design-submission-back"
          onPress={() => (unsavedEdit ? setConfirmingBack(true) : backToList())}
        >
          {dict.submission.backToSubmissions}
        </Link>
        {data ? (
          <div className="ms-auto">
            <PrintSubmissionButton print={print} baseName={printBaseName(data.submission)} />
          </div>
        ) : null}
      </div>
      {renderContent()}
      <ConfirmModal
        show={confirmingBack}
        title={dictReview.leaveEditTitle}
        message={dictReview.leaveEditMessage}
        confirmLabel={dictReview.leaveEditConfirm}
        cancelLabel={dictReview.leaveEditStay}
        onConfirm={backToList}
        onCancel={() => setConfirmingBack(false)}
      />
    </div>
  );
}
