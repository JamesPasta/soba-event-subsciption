'use client';

import { startTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Root-level error UI. Must define its own <html>/<body> (it replaces the root layout).
 * Providing this file avoids Next.js prerender failures on the internal `/_global-error` route.
 * Try again fetches the page from the server before resetting, as a server render failure would
 * otherwise show again.
 */
export default function GlobalError({
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
    <html lang="en">
      <body>
        <h1>Something went wrong</h1>
        {error.digest ? <p>Reference: {error.digest}</p> : null}
        <button type="button" onClick={retry}>
          Try again
        </button>
      </body>
    </html>
  );
}
