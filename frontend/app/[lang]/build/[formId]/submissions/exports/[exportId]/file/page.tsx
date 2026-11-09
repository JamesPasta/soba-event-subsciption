import { getDictionary, resolveLocale } from '../../../../../../dictionaries';
import { SubmissionExportDownload } from '@/src/features/designer/ui/SubmissionExportDownload';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';
import { assertFeatureAllowed } from '@/src/shared/featureFlags/assertFeatureAllowed';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';

type PageProps = {
  params: Promise<{ lang: string; formId: string; exportId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(
    params,
    (dict) => `${dict.submission.export.filePageTitle} | ${dict.general.title}`,
  );
}

export default async function Page({ params }: Readonly<PageProps>) {
  await assertFeatureAllowed(FEATURE_CODES.DESIGN_MODE);
  await assertFeatureAllowed(FEATURE_CODES.SUBMISSION_EXPORT);

  const { lang, formId, exportId } = await params;
  const dict = await getDictionary(resolveLocale(lang));

  return (
    <PageLayout headingId="export-file-heading" heading={dict.submission.export.filePageTitle}>
      <SubmissionExportDownload key={exportId} formId={formId} exportId={exportId} />
    </PageLayout>
  );
}
