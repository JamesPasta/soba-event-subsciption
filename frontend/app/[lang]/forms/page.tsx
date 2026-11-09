import { getDictionary, resolveLocale } from '../dictionaries';
import FormList from '@/src/features/designer/ui/FormList';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(
    params,
    (dict) => `${dict.formioV5.formList.tableHeading} | ${dict.general.title}`,
  );
}

export default async function Page({ params }: Readonly<PageProps>) {
  const param = await params;
  const locale = resolveLocale(param.lang);
  const dict = await getDictionary(locale);

  return (
    <PageLayout headingId="forms-heading" heading={dict.general.forms}>
      <FormList />
    </PageLayout>
  );
}
