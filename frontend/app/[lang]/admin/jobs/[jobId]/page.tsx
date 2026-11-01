import { getDictionary, resolveLocale } from '../../../dictionaries';
import JobDetailPanel from '@/src/features/admin/ui/JobDetailPanel';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string; jobId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.jobs.detail.heading} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const { lang, jobId } = await params;
  const dict = await getDictionary(resolveLocale(lang));

  return (
    <PageLayout headingId="job-heading" heading={dict.jobs.detail.heading}>
      <JobDetailPanel jobId={jobId} />
    </PageLayout>
  );
}
