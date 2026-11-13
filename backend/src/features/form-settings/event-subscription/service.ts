import type { EventSubscriptionSettings, SetEventSubscriptionSettingsBody } from '@soba/lib';
import { NotFoundError } from '../../../core/errors';
import { assertSaved } from '../saved';
import type { FormSettingsContext, FormSettingsService } from '../routes';
import { decryptSubscriptionToken, encryptSubscriptionToken } from './token';
import {
  findEncryptedEventSubscriptionToken,
  findEventSubscription,
  updateEventSubscription,
} from './repo';

const NOT_FOUND = 'Form event subscription settings not found';

const readForm = async (ctx: FormSettingsContext, formId: string) => {
  const settings = await findEventSubscription(ctx.workspaceId, formId);
  if (!settings) throw new NotFoundError(NOT_FOUND);
  return settings;
};

export const eventSubscriptionService: FormSettingsService<
  EventSubscriptionSettings,
  SetEventSubscriptionSettingsBody
> = {
  get: readForm,

  async set(ctx, formId, body) {
    const encryptedToken =
      body.token === undefined ? undefined : encryptSubscriptionToken(body.token);
    const status = await updateEventSubscription({
      workspaceId: ctx.workspaceId,
      formId,
      endpointUrl: body.endpointUrl,
      key: body.key,
      encryptedToken,
      version: body.version,
      actorDisplayLabel: ctx.actorDisplayLabel,
      audit: { actorId: ctx.actorId ?? null },
    });
    assertSaved(status, NOT_FOUND);
    return readForm(ctx, formId);
  },
};

export const revealEventSubscriptionToken = async (
  ctx: FormSettingsContext,
  formId: string,
): Promise<{ token: string }> => {
  const encrypted = await findEncryptedEventSubscriptionToken(ctx.workspaceId, formId);
  if (!encrypted) throw new NotFoundError('Endpoint token not found');
  return { token: decryptSubscriptionToken(encrypted) };
};
