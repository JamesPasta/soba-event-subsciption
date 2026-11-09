'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { InlineAlert } from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useDictionary } from '@/app/[lang]/Providers';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { canSaveDraftOnSubmission, canWriteSubmission } from '@/src/shared/util/permissions';
import { useBcgovFileOption } from '@/src/features/formio-v5/useBcgovFileOption';
import { useMountedLoad, type MountedLoad } from '@/src/features/formio-v5/fillMount';
import { useFillSession } from '@/src/features/formio-v5/data/useFillSession';
import { useSubmitFill } from '@/src/features/formio-v5/data/useSubmitFill';
import {
  SubmissionFillForm,
  type FillLabels,
} from '@/src/features/formio-v5/ui/SubmissionFillForm';
import { useFillLabels } from '@/src/features/formio-v5/ui/useFillLabels';
import { SubmissionLoadAlert } from '@/src/features/submissions/ui/SubmissionLoadAlert';
import { useAccessCaller } from '@/src/shared/api/useAccessCaller';
import { SubmissionWorkflowState } from '@/src/types/submissions';

/**
 * Loads an already-opened submission for filling and decides, with the @soba/lib rules over the
 * bundle's facts, whether the caller may write it and save a draft. The form mounts once the
 * bundle, the caller and the file limits are known, since Form.io reads its options only then.
 */
function SubmissionFill({
  submissionId,
  labels,
}: Readonly<{
  submissionId: string;
  labels: FillLabels;
}>) {
  const router = useRouter();
  const locale = getLocaleFromPath(usePathname());
  const session = useFillSession();
  const fill = useSubmitFill(submissionId, session);
  const { caller, pending: callerPending } = useAccessCaller();
  const files = useBcgovFileOption();
  // Each load the filler asks for mounts a new form; no other bundle reaches Form.io.
  const [loadId, setLoadId] = useState(0);

  const bundle = fill.data;
  const submitted = bundle?.workflowState === SubmissionWorkflowState.submitted;
  const submissionPath = `/${locale}/submission/${submissionId}`;

  useEffect(() => {
    if (submitted) router.replace(submissionPath);
  }, [submitted, submissionPath, router]);

  const { refresh } = fill;
  const reload = useCallback(async () => {
    await refresh();
    setLoadId((id) => id + 1);
  }, [refresh]);

  // A submitted submission isn't fillable; the effect above leaves for its view.
  const ready = !!bundle && !fill.error && !submitted && !callerPending && files.ready;
  let live: MountedLoad | null = null;
  if (ready) {
    const access = { role: bundle.role, workflowState: bundle.workflowState };
    live = {
      loadId: String(loadId),
      bundle,
      canWrite: canWriteSubmission(access, bundle.form, caller),
      canSaveDraft: canSaveDraftOnSubmission(access, bundle.form, caller),
    };
  }
  const mounted = useMountedLoad(live, String(loadId));

  if (!mounted) {
    return fill.error ? (
      <SubmissionLoadAlert error={fill.error} />
    ) : (
      <CenteredProgress label={labels.loading} />
    );
  }

  const { canWrite, canSaveDraft } = mounted;
  return (
    <SubmissionFillForm
      // A wider decision mounts a new form; it can only open the form up, so no typed answers are lost.
      key={`${mounted.loadId}:${canWrite}:${canSaveDraft}`}
      submissionId={submissionId}
      submissionPath={submissionPath}
      view={{
        snapshot: mounted.bundle,
        canWrite,
        canSaveDraft,
        fileOption: files.option,
        signedIn: session.signedIn,
      }}
      labels={labels}
      onReload={reload}
    />
  );
}

export default function FormioV5SubmissionFillClient({
  submissionId,
}: Readonly<{ submissionId: string }>) {
  const dict = useDictionary();
  const labels = useFillLabels();

  if (!submissionId) {
    return (
      <InlineAlert variant="danger" role="alert">
        {dict.formioV5.formRender.missingId}
      </InlineAlert>
    );
  }

  return (
    <div className="mt-3">
      <SubmissionFill key={submissionId} submissionId={submissionId} labels={labels} />
    </div>
  );
}
