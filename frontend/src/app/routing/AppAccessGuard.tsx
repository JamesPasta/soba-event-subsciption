'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { PageColumn } from '@/src/components/PageLayout';
import { useDictionary } from '@/app/[lang]/Providers';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useRefreshCurrentUser } from '@/src/shared/api/useCurrentUser';
import { resolveRedirect } from './appRoutePolicy';
import { useAppSession } from './useAppSession';

type AppAccessGuardProps = {
  locale: string;
  designMode: boolean;
  children: React.ReactNode;
};

/** Central session bootstrap and route access policy for localized app routes. */
export function AppAccessGuard({ locale, designMode, children }: Readonly<AppAccessGuardProps>) {
  const dict = useDictionary();
  const router = useRouter();
  const pathname = usePathname();
  const { refresh } = useKeycloak();
  const refreshCurrentUser = useRefreshCurrentUser();
  const session = useAppSession();

  const redirectTarget = useMemo(() => {
    return resolveRedirect(pathname, locale, session, designMode);
  }, [pathname, locale, session, designMode]);

  useEffect(() => {
    if (redirectTarget) {
      router.replace(redirectTarget);
    }
  }, [redirectTarget, router]);

  const handleRetry = useCallback(async () => {
    // A failed bootstrap read is usually an expired token, so refresh before re-reading. If the
    // refresh token has also expired, refreshing clears auth and the user is sent to sign in.
    await refresh();
    await refreshCurrentUser();
  }, [refresh, refreshCurrentUser]);

  // Same rule as the spinner below: once bootstrapped, a failed background reload must not replace
  // the route either. The retry lives on the next full load.
  if (session.sessionFailed && !session.sessionLoadedOnce && !redirectTarget) {
    return (
      <PageColumn>
        <div className="mt-4" role="alert">
          <InlineAlert variant="danger">{dict.general.sessionError}</InlineAlert>
          <div className="mt-3">
            <Button
              type="button"
              variant="primary"
              onPress={() => {
                handleRetry().catch(() => undefined);
              }}
              data-testid="session-error-retry"
            >
              {dict.general.tryAgain}
            </Button>
          </div>
        </div>
      </PageColumn>
    );
  }

  // Only the first load hides the app. A background reload (a token rotation re-reading /me) must
  // not swap children for the spinner — unmounting the route would discard a form being filled.
  const showLoading =
    !session.sessionLoadedOnce &&
    (session.initializing ||
      (session.authenticated && !session.sessionReady && !session.sessionFailed));

  if (showLoading || redirectTarget !== null) {
    return (
      <PageColumn>
        <CenteredProgress label={dict.general.loading} minHeight="50vh" />
      </PageColumn>
    );
  }

  return <>{children}</>;
}
