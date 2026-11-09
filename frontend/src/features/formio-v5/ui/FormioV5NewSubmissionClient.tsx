'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InlineAlert } from '@bcgov/design-system-react-components';
import { v7 as uuidv7 } from 'uuid';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { useDictionary } from '@/app/[lang]/Providers';
import { withBasePath } from '@/src/shared/config/basePath';
import { getLocaleFromPath } from '@/src/shared/util/locale';
import { canSaveSubmissionDraft, canStartSubmission } from '@/src/shared/util/permissions';
import { useBcgovFileOption } from '@/src/features/formio-v5/useBcgovFileOption';
import { useMountedLoad, type MountedLoad } from '@/src/features/formio-v5/fillMount';
import { useFillSession } from '@/src/features/formio-v5/data/useFillSession';
import { useSubmissionOpener } from '@/src/features/formio-v5/data/useSubmissionOpener';
import {
  useSubmitForm,
  useSubmitFormVersionSchema,
} from '@/src/features/formio-v5/data/useSubmitForm';
import {
  SubmissionFillForm,
  type FillLabels,
  type FormUpdate,
} from '@/src/features/formio-v5/ui/SubmissionFillForm';
import { useFillLabels } from '@/src/features/formio-v5/ui/useFillLabels';
import type { DataError } from '@/src/shared/api/dataContracts';
import { apiErrorMessage } from '@/src/shared/api/dataError';
import { useAccessCaller } from '@/src/shared/api/useAccessCaller';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { LoadErrorAlert } from '@/src/shared/ui/LoadErrorAlert';
import type { SubmitFillBundle } from '@/src/types/forms';

/** A form or schema read failure, with the form's copy: refused as an open would be. */
function FormLoadAlert({ error, labels }: Readonly<{ error: DataError; labels: FillLabels }>) {
  const authDefaults = useAuthErrorDefaults();
  const coded = apiErrorMessage(error.cause, labels.errors);
  return (
    <LoadErrorAlert
      error={error}
      messages={{
        ...authDefaults,
        forbidden: coded ?? authDefaults.forbidden,
        notFound: coded ?? labels.errors.form_not_found,
        // The form never loaded, so the fill page's offline text, which speaks of kept answers, would
        // mislead.
        offline: labels.loadError,
        failed: apiErrorMessage(error.cause, labels.errors, labels.loadError) ?? labels.loadError,
      }}
      testIds={{
        sessionExpired: 'new-submission-session-expired',
        forbidden: 'new-submission-refused',
        notFound: 'new-submission-notfound',
        failed: 'new-submission-loaderror',
      }}
    />
  );
}

/** A move to a newer version, with the decisions of the form it moved from. */
type MovedTo = FormUpdate & { canWrite: boolean; canSaveDraft: boolean };

/** A path as the ids in it read: the router keeps an address percent-encoded. */
const decodedPath = (path: string): string => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/**
 * A new submission on the form's published version, rendered before it exists: the first save,
 * submit or upload opens it under the id minted here, then the address becomes its fill page. A
 * visit that writes nothing creates nothing.
 */
function NewSubmissionFill({ formId, labels }: Readonly<{ formId: string; labels: FillLabels }>) {
  const router = useRouter();
  const address = usePathname();
  const pathname = decodedPath(address);
  const locale = getLocaleFromPath(pathname);
  const session = useFillSession();
  const form = useSubmitForm(formId, session);
  const published = useSubmitFormVersionSchema(form.data?.publishedVersionId ?? null, session);
  const { caller, pending: callerPending } = useAccessCaller();
  const files = useBcgovFileOption();
  const [submissionId] = useState(() => uuidv7());
  const [moved, setMoved] = useState<MovedTo | null>(null);
  const opener = useSubmissionOpener(formId, submissionId, session.signedIn);

  const version = moved?.version ?? published.data;
  const startPath = `/${locale}/form/${formId}`;
  const fillPath = `/${locale}/submit/${submissionId}`;

  const onScreen = useRef(true);
  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);

  const open = useCallback(async () => {
    if (!version) throw new Error('No form version to open the submission on');
    const head = await opener.open({
      formVersionId: version.formVersionId,
      schemaHash: version.schemaHash,
    });
    // The submission exists now, so a refresh lands on its fill page, not on a new submission.
    // Only while this page is on screen at its start address, so an open that lands after the filler
    // left keeps the address they went to. One that lands while a navigation is still loading, before
    // the address changes, cancels that navigation and the filler stays here.
    if (onScreen.current && decodedPath(globalThis.location.pathname) === withBasePath(startPath)) {
      globalThis.history.replaceState(null, '', withBasePath(fillPath));
    }
    return head;
  }, [opener, version, startPath, fillPath]);

  // History can show this page at an address that is not its own: Back to an opened submission's
  // address restores the page that address was made from. The server routes such an address. Once
  // handing over, every later address goes to the server too, its own included: the load held here
  // predates the open, so a form mounted from it again would open and write over the saved one.
  const [handingOver, setHandingOver] = useState(false);
  const elsewhere = pathname !== startPath && pathname !== fillPath;
  if (elsewhere && !handingOver) setHandingOver(true);
  const leaving = handingOver || elsewhere;
  useEffect(() => {
    if (leaving) router.replace(address);
  }, [leaving, address, router]);

  // A held write happens only once the submission is open; its latest version is the fill page's.
  // That page takes over, so this one stays busy, with writes blocked, until it unmounts.
  const reload = useCallback(async () => {
    router.replace(fillPath);
    await new Promise<never>(() => undefined);
  }, [router, fillPath]);

  const facts = moved?.form ?? form.data;
  const snapshot = useMemo<SubmitFillBundle | null>(
    () =>
      facts && version
        ? {
            formId: facts.id,
            workflowState: 'opened',
            formVersionId: version.formVersionId,
            headRevisionId: null,
            currentRevisionNo: 0,
            role: 'owner',
            form: facts,
            schema: version.schema,
            content: moved ? { data: moved.data } : null,
          }
        : null,
    [facts, version, moved],
  );

  // The published version is one load and each move to a newer version another. A move carries
  // the facts and the version it needs, so a read failing since, as when the session ends, does not
  // stop it. Its decisions only widen on the form it moved from: a caller who could write keeps
  // writing, and the server still refuses what it must, while a session that ended since reports
  // that on the next write rather than turning the form read-only.
  const loadId = moved?.version.formVersionId ?? 'published';
  const error = moved ? null : (form.error ?? published.error);
  let live: MountedLoad | null = null;
  if (snapshot && facts && !error && !callerPending && files.ready) {
    live = {
      loadId,
      bundle: snapshot,
      canWrite: canStartSubmission(facts, caller) || (moved?.canWrite ?? false),
      canSaveDraft: canSaveSubmissionDraft(facts, caller) || (moved?.canSaveDraft ?? false),
    };
  }
  const mounted = useMountedLoad(live, loadId);

  const mountedWrite = mounted?.canWrite ?? false;
  const mountedDraft = mounted?.canSaveDraft ?? false;
  const moveTo = useCallback(
    (update: FormUpdate) => {
      setMoved({ ...update, canWrite: mountedWrite, canSaveDraft: mountedDraft });
    },
    [mountedWrite, mountedDraft],
  );

  if (leaving) return <CenteredProgress label={labels.loading} />;

  if (!mounted) {
    return error ? (
      <FormLoadAlert error={error} labels={labels} />
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
      submissionPath={`/${locale}/submission/${submissionId}`}
      view={{
        snapshot: mounted.bundle,
        canWrite,
        canSaveDraft,
        fileOption: files.option,
        signedIn: session.signedIn,
        // Taken when the form mounts, so it keeps the version the form shows.
        open,
      }}
      labels={labels}
      onReload={reload}
      onFormUpdated={moveTo}
    />
  );
}

/**
 * Counts arrivals at the start address. Once a submission opens, the address becomes its fill page
 * while this page stays mounted, so the router would keep the opened submission on a later visit to
 * the start address; each arrival back at it starts a new one.
 */
function useStartVisit(startPath: string): number {
  const pathname = decodedPath(usePathname());
  const [seen, setSeen] = useState({ pathname, visit: 0 });
  if (seen.pathname !== pathname) {
    setSeen({ pathname, visit: pathname === startPath ? seen.visit + 1 : seen.visit });
  }
  return seen.visit;
}

export default function FormioV5NewSubmissionClient({ formId }: Readonly<{ formId: string }>) {
  const dict = useDictionary();
  const labels = useFillLabels();
  const locale = getLocaleFromPath(decodedPath(usePathname()));
  const visit = useStartVisit(`/${locale}/form/${formId}`);

  if (!formId) {
    return (
      <InlineAlert variant="danger" role="alert">
        {dict.formioV5.formRender.missingId}
      </InlineAlert>
    );
  }

  return (
    <div className="mt-3">
      <NewSubmissionFill key={`${formId}:${visit}`} formId={formId} labels={labels} />
    </div>
  );
}
