import { getDictionary, resolveLocale } from '../../../../dictionaries';
import { SubmissionExport } from '@/src/features/designer/ui/SubmissionExport';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';
import { assertFeatureAllowed } from '@/src/shared/featureFlags/assertFeatureAllowed';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';

type PageProps = {
  params: Promise<{ lang: string; formId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(
    params,
    (dict) => `${dict.submission.export.pageTitle} | ${dict.general.title}`,
  );
}

export default async function Page({ params }: Readonly<PageProps>) {
  await assertFeatureAllowed(FEATURE_CODES.DESIGN_MODE);
  await assertFeatureAllowed(FEATURE_CODES.SUBMISSION_EXPORT);

  const { lang, formId } = await params;
  const dict = await getDictionary(resolveLocale(lang));

  return (
    <PageLayout headingId="submission-export-heading" heading={dict.submission.export.pageTitle}>
      <SubmissionExport key={formId} formId={formId} />
    </PageLayout>
  );
}
