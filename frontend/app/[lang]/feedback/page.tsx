import { getDictionary, resolveLocale } from '../dictionaries';
import { PageLayout } from '@/src/components/PageLayout';
import { SecondaryText } from '@/src/components/SecondaryText';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string }>;
};
export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.general.feedback} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const param = await params;
  const locale = resolveLocale(param.lang);
  const dict = await getDictionary(locale);

  return (
    <PageLayout headingId="feedback-heading" heading={dict.general.feedback} width="narrow">
      <SecondaryText elementType="p" size="medium" data-testid="feedback-coming-soon">
        {dict.general.comingSoon}
      </SecondaryText>
    </PageLayout>
  );
}
