import { getDictionary, resolveLocale } from '../dictionaries';
import { PageLayout } from '@/src/components/PageLayout';
import { MySubmissionsList } from '@/src/features/submit-mode/ui/MySubmissionsList';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.general.mySubmissions} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const param = await params;
  const locale = resolveLocale(param.lang);
  const dict = await getDictionary(locale);

  return (
    <PageLayout headingId="my-submissions-heading" heading={dict.general.mySubmissions}>
      <MySubmissionsList />
    </PageLayout>
  );
}
