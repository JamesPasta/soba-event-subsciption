import {
  DEFAULT_SORT_LOCALE,
  type Audience,
  type FormAudienceSettings,
  type SetFormAudienceSettingsBody,
  type WorkspaceAudienceSettings,
} from '@soba/lib';
import { NotFoundError, ValidationError } from '../../../core/errors';
import { listLoginIdentityProviders } from '../../../core/db/repos/identityProviderRepo';
import {
  createFormAudienceSetting,
  findFormAudience,
  findWorkspaceAudience,
  updateFormAudience,
  updateWorkspaceAudience,
} from '../../../core/db/repos/audienceSettingRepo';
import { toInheritableSettings } from '../inheritable';
import { assertSaved } from '../saved';
import type { FormSettingsContext, FormSettingsService } from '../routes';
import type { DbOrTx } from '../../../core/db/client';
import type { FormSettingsRowInput } from '../types';

const FORM_NOT_FOUND = 'Form audience settings not found';
const WORKSPACE_NOT_FOUND = 'Workspace audience settings not found';

/**
 * The audience as stored: providers deduplicated and sorted. Refuses codes that aren't active login
 * providers, which also keeps out `public` and `system`. Inside a transaction, pass the transaction,
 * so the check does not wait on a second connection.
 */
const toStored = async (audience: Audience, executor?: DbOrTx): Promise<Audience> => {
  if (audience.mode !== 'protected') return audience;
  // Code unit order, as stored. The codes are unique after the Set, so none compare equal.
  const idps = [...new Set(audience.idps)].sort((a, b) => (a < b ? -1 : 1));
  const providers = await listLoginIdentityProviders(DEFAULT_SORT_LOCALE, executor);
  const valid = new Set(providers.map((p) => p.code));
  const bad = idps.filter((code) => !valid.has(code));
  if (bad.length) {
    throw new ValidationError(`Not assignable login providers: ${bad.join(', ')}`);
  }
  return { mode: 'protected', idps };
};

const readForm = async (ctx: FormSettingsContext, formId: string) => {
  const row = await findFormAudience(ctx.workspaceId, formId);
  if (!row) throw new NotFoundError(FORM_NOT_FOUND);
  return toInheritableSettings(row, row.workspace);
};

/** Creates a new form's audience row: inheriting, or the audience sent with the new form, audited. */
export const createFormAudience = async (
  input: FormSettingsRowInput,
  executor: DbOrTx,
): Promise<void> => {
  const body = input.settings?.audience;
  const own = body?.inherit === false ? await toStored(body.values, executor) : null;
  await createFormAudienceSetting(
    {
      workspaceId: input.workspaceId,
      formId: input.formId,
      audience: own,
      actorDisplayLabel: input.actorDisplayLabel,
      audit: own ? { actorId: input.actorId } : undefined,
    },
    executor,
  );
};

/** A form's audience: inherited from its workspace, or its own. */
export const formAudienceService: FormSettingsService<
  FormAudienceSettings,
  SetFormAudienceSettingsBody
> = {
  get: readForm,

  async set(ctx, formId, body) {
    const status = await updateFormAudience({
      workspaceId: ctx.workspaceId,
      formId,
      audience: body.inherit === false ? await toStored(body.values) : null,
      version: body.version,
      actorDisplayLabel: ctx.actorDisplayLabel,
      audit: { actorId: ctx.actorId ?? null },
    });
    assertSaved(status, FORM_NOT_FOUND);
    return readForm(ctx, formId);
  },
};

const readWorkspace = async (ctx: FormSettingsContext) => {
  const settings = await findWorkspaceAudience(ctx.workspaceId);
  if (!settings) throw new NotFoundError(WORKSPACE_NOT_FOUND);
  return settings;
};

/** A workspace's audience, which its forms inherit unless they set their own. */
export const workspaceAudienceService: FormSettingsService<
  WorkspaceAudienceSettings,
  WorkspaceAudienceSettings
> = {
  get: readWorkspace,

  async set(ctx, _workspaceId, body) {
    const status = await updateWorkspaceAudience({
      workspaceId: ctx.workspaceId,
      audience: await toStored(body.values),
      version: body.version,
      actorDisplayLabel: ctx.actorDisplayLabel,
      audit: { actorId: ctx.actorId ?? null },
    });
    assertSaved(status, WORKSPACE_NOT_FOUND);
    return readWorkspace(ctx);
  },
};
