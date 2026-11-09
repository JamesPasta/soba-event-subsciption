import { getDictionary, resolveLocale } from '../../dictionaries';
import FormDesignerLoader from '@/src/features/designer/ui/FormDesignerLoader';
import { PageLayout } from '@/src/components/PageLayout';
import { pageMetadata } from '@/src/shared/config/pageMetadata';
import { assertFeatureAllowed } from '@/src/shared/featureFlags/assertFeatureAllowed';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';

type PageProps = {
  params: Promise<{ lang: string; formId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `Form Designer | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  await assertFeatureAllowed(FEATURE_CODES.DESIGN_MODE);

  const { lang, formId } = await params;
  const dict = await getDictionary(resolveLocale(lang));

  return (
    <PageLayout headingId="designer-heading" heading={dict.general.formDesigner} width="wide">
      {/* Keyed so navigating between two forms remounts rather than carrying the previous form's
          selected version and unsaved edits across. */}
      <FormDesignerLoader key={formId} formId={formId} />
    </PageLayout>
  );
}
