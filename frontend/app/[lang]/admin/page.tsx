import { getDictionary, resolveLocale } from '../dictionaries';
import AdminDashboard from '@/src/features/admin/ui/AdminDashboard';
import { PageLayout } from '@/src/components/PageLayout';
import { loadFeaturesMeta } from '@/src/shared/config/featuresMeta';
import { getAdminFeatureMeta } from '@/src/features/admin/featureMeta';
import { pageMetadata } from '@/src/shared/config/pageMetadata';

type PageProps = {
  params: Promise<{ lang: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  return pageMetadata(params, (dict) => `${dict.admin.heading} | ${dict.general.title}`);
}

export default async function Page({ params }: Readonly<PageProps>) {
  const [{ lang }, featuresMeta] = await Promise.all([params, loadFeaturesMeta()]);
  const dict = await getDictionary(resolveLocale(lang));
  const { documentGenerationEnabled, scopedFeatureCodes } = getAdminFeatureMeta(featuresMeta);

  return (
    <PageLayout headingId="admin-heading" heading={dict.admin.heading}>
      <AdminDashboard
        scopedFeatureCodes={scopedFeatureCodes}
        documentGenerationEnabled={documentGenerationEnabled}
      />
    </PageLayout>
  );
}
