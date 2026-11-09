import { getDictionary, resolveLocale } from '../../../../dictionaries';
import { FormJobPage } from '@/src/features/jobs/ui/ScopedJobPages';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';
import { assertFeatureAllowed } from '@/src/shared/featureFlags/assertFeatureAllowed';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';

type PageProps = {
  params: Promise<{ lang: string; formId: string; jobId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.jobs.detail.heading} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  await assertFeatureAllowed(FEATURE_CODES.DESIGN_MODE);

  const { lang, formId, jobId } = await params;
  const dict = await getDictionary(resolveLocale(lang));

  return (
    <PageLayout headingId="form-job-heading" heading={dict.jobs.detail.heading}>
      <FormJobPage key={jobId} formId={formId} jobId={jobId} />
    </PageLayout>
  );
}
