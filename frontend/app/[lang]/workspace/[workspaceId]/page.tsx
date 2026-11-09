import { getDictionary, resolveLocale } from '../../dictionaries';
import WorkspaceFormLoader from '@/src/features/workspaces/ui/WorkspaceFormLoader';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string; workspaceId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.workspaces.manageHeading} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const param = await params;
  const locale = resolveLocale(param.lang);
  const dict = await getDictionary(locale);

  return (
    <PageLayout headingId="workspace-form-heading" heading={dict.workspaces.manageHeading}>
      <WorkspaceFormLoader workspaceId={param.workspaceId} />
    </PageLayout>
  );
}
