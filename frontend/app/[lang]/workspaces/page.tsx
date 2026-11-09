import { getDictionary, resolveLocale } from '../dictionaries';
import WorkspaceList from '@/src/features/workspaces/ui/WorkspaceList';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.workspaces.tableHeading} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const param = await params;
  const locale = resolveLocale(param.lang);
  const dict = await getDictionary(locale);

  return (
    <PageLayout headingId="workspaces-heading" heading={dict.workspaces.tableHeading}>
      <WorkspaceList />
    </PageLayout>
  );
}
