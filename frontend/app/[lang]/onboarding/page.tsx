import { getDictionary, resolveLocale } from '../dictionaries';
import OnboardingPage from '@/src/features/onboarding/ui/OnboardingPage';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.onboarding.heading} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const param = await params;
  const locale = resolveLocale(param.lang);
  const dict = await getDictionary(locale);

  return (
    <PageLayout headingId="onboarding-heading" heading={dict.onboarding.heading} width="narrow">
      <OnboardingPage />
    </PageLayout>
  );
}
