import { getDictionary, resolveLocale } from '../../../../../../dictionaries';
import { SubmissionFileDownload } from '@/src/features/designer/ui/SubmissionFileDownload';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';
import { assertFeatureAllowed } from '@/src/shared/featureFlags/assertFeatureAllowed';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';

type PageProps = {
  params: Promise<{ lang: string; formId: string; submissionId: string; fileId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(
    params,
    (dict) => `${dict.fileDownload.pageTitle} | ${dict.general.title}`,
  );
}

export default async function Page({ params }: Readonly<PageProps>) {
  await assertFeatureAllowed(FEATURE_CODES.DESIGN_MODE);

  const { lang, formId, submissionId, fileId } = await params;
  const dict = await getDictionary(resolveLocale(lang));

  return (
    <PageLayout headingId="submission-file-heading" heading={dict.fileDownload.pageTitle}>
      <SubmissionFileDownload
        key={fileId}
        formId={formId}
        submissionId={submissionId}
        fileId={fileId}
      />
    </PageLayout>
  );
}
