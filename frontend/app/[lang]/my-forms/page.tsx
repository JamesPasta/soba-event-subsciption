import { getDictionary, resolveLocale } from '../dictionaries';
import { PageLayout } from '@/src/components/PageLayout';
import { MyFormsList } from '@/src/features/submit-mode/ui/MyFormsList';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.general.myForms} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const param = await params;
  const locale = resolveLocale(param.lang);
  const dict = await getDictionary(locale);

  return (
    <PageLayout headingId="my-forms-heading" heading={dict.general.myForms}>
      <MyFormsList />
    </PageLayout>
  );
}
