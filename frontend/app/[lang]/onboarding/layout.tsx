import { assertFeatureAllowed } from '@/src/shared/featureFlags/assertFeatureAllowed';
import { FEATURE_CODES } from '@/src/shared/featureFlags/flags';

export default async function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await assertFeatureAllowed(FEATURE_CODES.DESIGN_MODE);

  return <>{children}</>;
}
