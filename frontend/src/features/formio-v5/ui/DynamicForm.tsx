'use client';

import dynamic from 'next/dynamic';
import type { FormProps } from '@formio/react';
import { useFormioV5FormChrome } from '@/lib/hooks/useFormioV5FormChrome';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { ensureBcgovFormioRegistered } from '@/src/features/formio-v5/registerBcgovFormio';

function FormioV5FormChrome({ children }: { children: React.ReactNode }) {
  useFormioV5FormChrome('render');
  return children;
}

/**
 * The Form.io renderer loaded client-side only (no SSR). Shared by the designer preview, the live
 * renderer, and the read-only submission viewer so the dynamic-import boilerplate lives in one place.
 * V5 renderer styles are injected only while this component is mounted.
 */
const FormioForm = dynamic<FormProps>(
  async () => {
    // Register the bcgov components + CHEFS provider (feature-gated) before the form renders.
    const [mod] = await Promise.all([import('@formio/react'), ensureBcgovFormioRegistered()]);
    return mod.Form;
  },
  {
    ssr: false,
    loading: () => <CenteredProgress />,
  },
);

export function DynamicForm(props: Readonly<FormProps>) {
  return (
    <FormioV5FormChrome>
      <FormioForm {...props} />
    </FormioV5FormChrome>
  );
}
