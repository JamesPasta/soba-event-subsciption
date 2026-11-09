'use client';

import { useParams, usePathname, useRouter } from 'next/navigation';
import { InlineAlert, Link } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useDictionary } from '@/app/[lang]/Providers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { SubmissionDetail } from '@/src/features/submissions/ui/SubmissionDetail';
import { SubmissionLoadAlert } from '@/src/features/submissions/ui/SubmissionLoadAlert';
import { useSubmitSubmission } from '@/src/features/submit-mode/data/useSubmitSubmission';
import { useSubmitterPrint } from '@/src/features/templates/data/useSubmissionPrint';
import { printBaseName } from '@/src/features/templates/printFileName';
import { PrintSubmissionButton } from '@/src/features/templates/ui/PrintSubmissionButton';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { SubmissionWorkflowState, SubmitterReviewLabels } from '@/src/types/submissions';

/** A submitter's view of one submission; `success` is the confirmation shown right after submit. */
export function SubmissionView({ success = false }: Readonly<{ success?: boolean }>) {
  const params = useParams();
  const dict = useDictionary();
  const router = useRouter();
  const locale = getLocaleFromPath(usePathname());
  const { authenticated } = useKeycloak();

  const submissionIdRaw = params?.submissionId;
  const submissionId =
    typeof submissionIdRaw === 'string' ? decodeURIComponent(submissionIdRaw) : '';

  const { data, isLoading, error } = useSubmitSubmission(submissionId);
  const print = useSubmitterPrint(submissionId);

  const renderContent = () => {
    // A failed background revalidation keeps the submission already on screen.
    if (data) {
      const detail = (
        <SubmissionDetail
          submission={data.submission}
          schema={data.schema}
          content={data.content}
          reviewLabel={data.submission.reviewLabel}
        />
      );
      const actions = (link: React.ReactNode) => (
        <div className="mb-3 d-flex align-items-center gap-2 d-print-none">
          {link}
          <div className="ms-auto">
            <PrintSubmissionButton print={print} baseName={printBaseName(data.submission)} />
          </div>
        </div>
      );
      if (!success) {
        return (
          <>
            {actions(
              data.submission.canContinue &&
                data.submission.reviewLabel === SubmitterReviewLabels.revisionRequested ? (
                <Link
                  data-testid="submission-view-continue"
                  onPress={() => router.push(`/${locale}/submit/${submissionId}`)}
                >
                  {dict.mySubmissions.continue}
                </Link>
              ) : null,
            )}
            {detail}
          </>
        );
      }
      if (data.submission.workflowState !== SubmissionWorkflowState.submitted) {
        return (
          <InlineAlert
            variant="info"
            role="status"
            title={dict.submission.success.notSubmitted}
            data-testid="submission-success-not-submitted"
          />
        );
      }
      return (
        <div data-testid="submission-success">
          <div className="mb-3">
            <InlineAlert
              variant="success"
              role="status"
              title={dict.submission.success.message}
              description={dict.submission.success.keepConfirmation}
            />
          </div>
          {/* Signed in only; the bare URL opens the list unfiltered. */}
          {actions(
            authenticated ? (
              <Link
                data-testid="submission-success-my-submissions"
                onPress={() => router.push(`/${locale}/my-submissions`)}
              >
                {dict.mySubmissions.viewAll}
              </Link>
            ) : null,
          )}
          {detail}
        </div>
      );
    }
    if (error) return <SubmissionLoadAlert error={error} />;
    if (isLoading) return <CenteredProgress label={dict.general.loading} />;
    return <SubmissionLoadAlert error={{ kind: 'notFound', cause: null }} />;
  };

  return (
    <div className="mt-3" data-testid="submission-view">
      {renderContent()}
    </div>
  );
}
