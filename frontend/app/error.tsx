'use client';

import { startTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Error boundary for everything under the root layout, including `[lang]/layout.tsx` itself. A
 * segment boundary cannot catch a throw from its own layout, so the backend bootstrap failures
 * raised there (features meta, dictionaries) land here.
 *
 * The locale is unknown at this level, so the copy stays untranslated. Route-level boundaries that
 * can reach the dictionary belong closer to the page, as in `[lang]/form/[formId]/error.tsx`.
 *
 * Try again fetches the page from the server before resetting: the failure was the server's render,
 * so resetting alone would show the same error again.
 */
export default function AppError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main id="main-content" className="p-5" data-testid="app-error-page">
      <h1 className="h4">This service is temporarily unavailable</h1>
      <p>The application could not reach a service it needs to start. Try again in a moment.</p>
      <p>
        <button type="button" onClick={retry} data-testid="app-error-retry">
          Try again
        </button>
      </p>
      {error.digest ? <p className="small text-muted">Reference: {error.digest}</p> : null}
    </main>
  );
}
