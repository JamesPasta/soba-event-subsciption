import { SubmissionView } from '@/src/features/submit-mode/ui/SubmissionView';
import { PageLayout } from '@/src/components/PageLayout';
import { getDictionary, resolveLocale } from '../../dictionaries';
import { pageMetadata } from '@/src/shared/config/pageMetadata';
import { assertFeatureAllowed } from '@/src/shared/featureFlags/assertFeatureAllowed';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';

type PageProps = {
  params: Promise<{ lang: string; submissionId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.submission.pageTitle} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  await assertFeatureAllowed(FEATURE_CODES.SUBMIT_MODE);

  const { lang, submissionId } = await params;
  const dict = await getDictionary(resolveLocale(lang));
  return (
    <PageLayout headingId="submission-view-heading" heading={dict.submission.pageTitle}>
      <SubmissionView key={submissionId} />
    </PageLayout>
  );
}
