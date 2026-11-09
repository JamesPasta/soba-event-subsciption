'use client';

/**
 * Segment error UI for `/[lang]/form/[formId]` only.
 *
 * Today: catches uncaught errors in this route segment (including escaped RSC/client failures).
 * The Form.io tree also uses `FormioV5FormRenderErrorBoundary` for renderer-local throws.
 *
 * Forward: add `app/[lang]/error.tsx` or `app/error.tsx`, extract shared fallback (alert + reset),
 * and optionally report `error.digest` / `captureException` to observability.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button, InlineAlert } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';

export default function FormIdRouteError({
  reset,
}: Readonly<{
  reset: () => void;
}>) {
  const params = useParams();
  const locale = typeof params?.lang === 'string' ? params.lang : 'en';
  const dict = useDictionary();
  const labels = dict.formioV5.formRender.segmentError;

  return (
    <div className="mt-4" role="alert">
      <InlineAlert variant="danger">{labels.title}</InlineAlert>
      <div className="d-flex flex-wrap gap-3">
        <Button type="button" variant="primary" onPress={() => reset()}>
          {labels.tryAgain}
        </Button>
        <Link className="text-decoration-underline" href={`/${locale}`}>
          {labels.backToHome}
        </Link>
      </div>
    </div>
  );
}
