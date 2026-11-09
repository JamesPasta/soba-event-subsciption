import { assertFeatureAllowed } from '@/src/shared/featureFlags/assertFeatureAllowed';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';

export default async function MySubmissionsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await assertFeatureAllowed(FEATURE_CODES.SUBMIT_MODE);

  return <>{children}</>;
}
