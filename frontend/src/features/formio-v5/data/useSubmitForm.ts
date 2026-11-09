'use client';

import { getSubmitForm, getSubmitFormVersionSchema } from '@/src/shared/api/sobaApi';
import type { Resource } from '@/src/shared/api/dataContracts';
import type { SubmitFormVersionSchemaResponse, SubmitterForm } from '@/src/types/forms';
import type { FillSession } from './useFillSession';
import { useFillRead } from './useFillRead';

/** A form the caller may start a submission on, with its facts, as the page's session. */
export function useSubmitForm(formId: string, session: FillSession): Resource<SubmitterForm> {
  return useFillRead(formId ? ['submit-form', formId] : null, session, (token) =>
    getSubmitForm(token, formId),
  );
}

/** A published version's schema and its hash, to render a new submission before it is opened. */
export function useSubmitFormVersionSchema(
  formVersionId: string | null,
  session: FillSession,
): Resource<SubmitFormVersionSchemaResponse> {
  return useFillRead(
    formVersionId ? ['submit-form-version-schema', formVersionId] : null,
    session,
    (token) => getSubmitFormVersionSchema(token, formVersionId ?? ''),
  );
}
