'use client';

import { useCallback } from 'react';
import useSWR, { type SWRConfiguration } from 'swr';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useCallToken } from '@/src/shared/api/callToken';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { DataError } from '@/src/shared/api/dataContracts';
import { isSessionExpired } from '@/src/shared/api/sobaFetch';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import { useAuthedSWR, useMaybeAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { loadFeaturesMeta } from '@/src/shared/config/featuresMeta';
import { createIsFeatureAllowed, FEATURE_CODES } from '@/src/shared/featureFlags/flags';
import {
  printChoiceOf,
  type PrintChoiceCode,
  type PrintOptions,
  type StaffPrintFacts,
} from '@/src/types/templates';
import { useDesignFormRead } from '@/src/features/designer/data/useForm';
import {
  getStaffPrintFacts,
  getSubmitterPrintFacts,
  printWithStoredTemplate,
  printWithUploadedTemplate,
} from './printApi';

export type StaffPrintTemplate = StaffPrintFacts['items'][number];

/** What the staff print options offer. */
export type StaffPrintOptions = {
  /** The stored template; null while it loads, when there is none, or when the facts failed. */
  template: StaffPrintTemplate | null;
  /** The facts could not be read, so no template print is offered. */
  error: DataError | null;
  printUploaded: (file: File, options: PrintOptions) => Promise<Blob>;
};

/** What Print does on one submission. */
export type SubmissionPrint = {
  /** Null while what it decides from is loading. */
  choice: PrintChoiceCode | null;
  /** Renders the form version's stored template; rejects when there is none. */
  printTemplate: (options: PrintOptions) => Promise<Blob>;
  /** The staff options; null on the submit surface. */
  staff: StaffPrintOptions | null;
};

type PrintFacts = { items: readonly { id: string }[]; renderAvailable: boolean };

// The print choice reads this when the app has no template print or its facts failed.
const NO_TEMPLATE_PRINT: PrintFacts = { items: [], renderAvailable: false };
const NO_PERMISSIONS: readonly string[] = [];

/** A refusal is the answer: retrying it only repeats the request. */
const printFactsReadConfig: SWRConfiguration = {
  shouldRetryOnError: (err: unknown) =>
    !isSessionExpired(err) && !(err instanceof ApiError && err.status < 500),
};

const isTemplatePrintAllowed = () =>
  loadFeaturesMeta().then(
    (meta) => createIsFeatureAllowed(meta)(FEATURE_CODES.TEMPLATES),
    () => false,
  );

/** Whether this app offers template print: null until the feature list loads, false if it fails. */
function useTemplatePrintAllowed(): boolean | null {
  const { data } = useSWR(
    ['feature-allowed', FEATURE_CODES.TEMPLATES],
    isTemplatePrintAllowed,
    sessionReadConfig,
  );
  return data ?? null;
}

/** The print choice from what a surface read; null while any of it is still loading. */
export function printChoiceFrom(read: {
  /** Whether the app offers template print; null while unknown. */
  allowed: boolean | null;
  facts: PrintFacts | undefined;
  /** The facts request failed. */
  failed: boolean;
  /** The caller's form permissions; null while unknown. */
  permissions: readonly string[] | null;
}): PrintChoiceCode | null {
  const facts = read.allowed === false || read.failed ? NO_TEMPLATE_PRINT : read.facts;
  if (!facts || !read.permissions) return null;
  return printChoiceOf({
    renderAvailable: facts.renderAvailable,
    hasTemplate: facts.items.length > 0,
    permissions: read.permissions,
  });
}

const NO_STORED_TEMPLATE = 'The form version has no stored template';

/** Print on the submit surface, signed in or not. */
export function useSubmitterPrint(submissionId: string): SubmissionPrint {
  const allowed = useTemplatePrintAllowed();
  const { token, initializing, initStarted } = useKeycloak();
  const { isSignedIn, tokenFor } = useCallToken();
  // Keycloak has to answer first, or the read goes out as anonymous.
  const ready = allowed === true && initStarted && !initializing && !!submissionId;

  const { data, error } = useMaybeAuthedSWR(
    ready ? ['submission-print-facts', submissionId, token ? 'user' : 'anonymous'] : null,
    (authToken) => getSubmitterPrintFacts(authToken, submissionId),
    printFactsReadConfig,
  );
  const templateId = error ? undefined : data?.items[0]?.id;

  const printTemplate = useCallback(
    async (options: PrintOptions) => {
      if (!templateId) throw new Error(NO_STORED_TEMPLATE);
      return printWithStoredTemplate(
        'submit',
        tokenFor(isSignedIn()),
        submissionId,
        templateId,
        options,
      );
    },
    [isSignedIn, submissionId, templateId, tokenFor],
  );

  const choice = printChoiceFrom({
    allowed,
    facts: data,
    failed: !!error,
    permissions: NO_PERMISSIONS,
  });
  return { choice, printTemplate, staff: null };
}

/** Print on the design surface: the caller's form permissions decide what it offers. */
export function useStaffPrint(formId: string, submissionId: string): SubmissionPrint {
  const allowed = useTemplatePrintAllowed();
  const { signedInToken } = useCallToken();

  // The build page reads the same key, so its cached form usually answers this.
  const { data: form, error: formError } = useDesignFormRead(formId);
  const { data, error } = useAuthedSWR(
    allowed ? ['staff-print-facts', submissionId] : null,
    (token) => getStaffPrintFacts(token, submissionId),
    printFactsReadConfig,
  );
  const template = error ? null : (data?.items[0] ?? null);
  const permissions = formError ? NO_PERMISSIONS : (form?.permissions ?? null);

  const printTemplate = useCallback(
    async (options: PrintOptions) => {
      if (!template) throw new Error(NO_STORED_TEMPLATE);
      return printWithStoredTemplate('design', signedInToken(), submissionId, template.id, options);
    },
    [signedInToken, submissionId, template],
  );
  const printUploaded = useCallback(
    async (file: File, options: PrintOptions) =>
      printWithUploadedTemplate(signedInToken(), submissionId, file, options),
    [signedInToken, submissionId],
  );

  return {
    choice: printChoiceFrom({ allowed, facts: data, failed: !!error, permissions }),
    printTemplate,
    staff: { template, error: error ? classifyDataError(error) : null, printUploaded },
  };
}
