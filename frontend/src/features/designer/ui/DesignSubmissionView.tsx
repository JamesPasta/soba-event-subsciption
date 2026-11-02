'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Link } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useDictionary } from '@/app/[lang]/Providers';
import { usePageHeading } from '@/src/components/PageHeader';
import { SubmissionLoadAlert } from '@/src/features/submissions/ui/SubmissionLoadAlert';
import { useDesignSubmission } from '@/src/features/designer/data/useDesignSubmission';
import { useStaffPrint } from '@/src/features/templates/data/useSubmissionPrint';
import { printBaseName } from '@/src/features/templates/printFileName';
import { PrintSubmissionButton } from '@/src/features/templates/ui/PrintSubmissionButton';
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

  usePageHeading({ heading: dict.submission.review.heading });

  const renderContent = () => {
    // A failed background revalidation keeps the submission already on screen.
    if (data) {
      return (
        <SubmissionReview
          submission={data.submission}
          schema={data.schema}
          content={data.content}
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
          onPress={() => router.push(navLink(`/${locale}/build/${formId}?tab=submissions`))}
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
    </div>
  );
}
