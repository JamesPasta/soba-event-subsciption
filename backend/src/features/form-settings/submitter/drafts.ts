import { draftSaveStatusOf, type DraftSaveStatusCode } from '@soba/lib';
import { findSubmitterFormFacts } from '../../../core/db/repos/submitterFormRepo';
import { NotFoundError } from '../../../core/errors';
import type { FormSettingsContext } from '../routes';

const FORM_NOT_FOUND = 'Form not found';

/** Whether the form accepts draft saves, or which check refuses them. */
export const getDraftSaveStatus = async (
  ctx: FormSettingsContext,
  formId: string,
): Promise<DraftSaveStatusCode> => {
  const facts = await findSubmitterFormFacts({
    userId: null,
    workspaceId: ctx.workspaceId,
    formId,
  });
  if (!facts) throw new NotFoundError(FORM_NOT_FOUND);
  return draftSaveStatusOf(facts);
};
