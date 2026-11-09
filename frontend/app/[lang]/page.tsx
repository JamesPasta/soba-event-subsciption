import LandingPage from '../ui/LandingPage';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';
import { getDictionary, resolveLocale } from './dictionaries';

type PageProps = {
  params: Promise<{ lang: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => dict.general.title);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const param = await params;
  const locale = resolveLocale(param.lang);
  const dict = await getDictionary(locale);

  return (
    <PageLayout
      headingId="landing-heading"
      heading={`${dict.general.welcomeTo} ${dict.general.titleAsService}`}
    >
      <LandingPage />
    </PageLayout>
  );
}
