import { getDictionary, resolveLocale } from '../../../dictionaries';
import FeatureScopePanel from '@/src/features/admin/ui/FeatureScopePanel';
import { PageLayout } from '@/src/components/PageLayout';
import { loadFeaturesMeta } from '@/src/shared/config/featuresMeta';
import { getAdminFeatureMeta } from '@/src/features/admin/featureMeta';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string; featureScopeId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(
    params,
    (dict) => `${dict.admin.featureScopes.manageHeading} | ${dict.general.title}`,
  );
}

export default async function Page({ params }: Readonly<PageProps>) {
  const [{ lang, featureScopeId }, featuresMeta] = await Promise.all([params, loadFeaturesMeta()]);
  const dict = await getDictionary(resolveLocale(lang));
  const { scopedFeatureCodes } = getAdminFeatureMeta(featuresMeta);

  return (
    <PageLayout
      headingId="feature-scope-form-heading"
      heading={dict.admin.featureScopes.manageHeading}
    >
      <FeatureScopePanel scopedFeatureCodes={scopedFeatureCodes} featureScopeId={featureScopeId} />
    </PageLayout>
  );
}
