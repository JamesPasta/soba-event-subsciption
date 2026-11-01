import { getDictionary, resolveLocale } from '../../../../dictionaries';
import { WorkspaceJobPage } from '@/src/features/jobs/ui/ScopedJobPages';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string; workspaceId: string; jobId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.jobs.detail.heading} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const { lang, workspaceId, jobId } = await params;
  const dict = await getDictionary(resolveLocale(lang));

  return (
    <PageLayout headingId="workspace-job-heading" heading={dict.jobs.detail.heading}>
      <WorkspaceJobPage key={jobId} workspaceId={workspaceId} jobId={jobId} />
    </PageLayout>
  );
}
