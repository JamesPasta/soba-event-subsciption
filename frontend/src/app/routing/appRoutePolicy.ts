import { navLink } from '@/src/shared/list/listQueryMemory';
import { ROUTE_KIND_BY_SEGMENT } from './routeSegments';

export type RouteKind = 'home' | 'onboarding' | 'workspace-app' | 'workspaces' | 'public';

export type AppSessionSnapshot = {
  authenticated: boolean;
  initializing: boolean;
  /** Keycloak init has been dispatched, so `authenticated` is an answer rather than a default. */
  initStarted: boolean;
  sessionReady: boolean;
  /** Every bootstrap read has produced data at least once. */
  sessionLoadedOnce: boolean;
  /** A required bootstrap fetch (current user or workspaces) rejected. */
  sessionFailed: boolean;
  needsOnboarding: boolean;
  canCreateWorkspace: boolean;
  hasWorkspaces: boolean;
};

/** Classify the localized route (pathname includes `/{locale}/...`). */
export function classifyRoute(pathname: string): RouteKind {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return 'home';
  }

  const route = segments[1] ?? '';
  return ROUTE_KIND_BY_SEGMENT[route] ?? 'public';
}

function resolveLanding(
  locale: string,
  onboarding: string,
  session: AppSessionSnapshot,
  designMode: boolean,
): string {
  if (!designMode) {
    return `/${locale}/my-forms`;
  }
  if (session.needsOnboarding) {
    return onboarding;
  }
  if (session.canCreateWorkspace && !session.hasWorkspaces) {
    return `/${locale}/workspaces`;
  }
  // Marked as an in-app arrival so the list comes back as the user left it.
  return navLink(`/${locale}/forms`);
}

/**
 * Returns a path to `router.replace`, or null when the current route may render.
 * Caller should wait until `sessionReady` before redirecting authenticated users.
 *
 * `designMode` is this deployment's DESIGN_MODE gate. When off, users land on My Forms and
 * workspace onboarding is skipped; `canCreateWorkspace` is per-user and not mode-aware.
 */
export function resolveRedirect(
  pathname: string,
  locale: string,
  session: AppSessionSnapshot,
  designMode: boolean,
): string | null {
  // Routing an unauthenticated user off a guarded route before Keycloak has run sends a deep link
  // to the landing page and drops its query string.
  if (session.initializing || !session.initStarted) {
    return null;
  }

  const kind = classifyRoute(pathname);
  const home = `/${locale}`;
  const onboarding = `/${locale}/onboarding`;

  if (!session.authenticated) {
    if (kind === 'home' || kind === 'public') {
      return null;
    }
    return home;
  }

  if (!session.sessionReady) {
    return null;
  }

  const needsOnboarding = designMode && session.needsOnboarding;
  const landing = resolveLanding(locale, onboarding, session, designMode);

  if (kind === 'home') {
    return landing;
  }

  if (kind === 'onboarding') {
    return needsOnboarding ? null : landing;
  }

  if (needsOnboarding && kind !== 'public') {
    return onboarding;
  }

  return null;
}
