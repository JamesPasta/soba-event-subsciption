import { getDictionary, resolveLocale } from '../../../../dictionaries';
import { DesignSubmissionView } from '@/src/features/designer/ui/DesignSubmissionView';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';
import { assertFeatureAllowed } from '@/src/shared/featureFlags/assertFeatureAllowed';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';

type PageProps = {
  params: Promise<{ lang: string; formId: string; submissionId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.submission.pageTitle} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  await assertFeatureAllowed(FEATURE_CODES.DESIGN_MODE);

  const { lang, formId, submissionId } = await params;
  const dict = await getDictionary(resolveLocale(lang));

  return (
    <PageLayout headingId="design-submission-heading" heading={dict.submission.pageTitle}>
      <DesignSubmissionView key={submissionId} formId={formId} submissionId={submissionId} />
    </PageLayout>
  );
}
