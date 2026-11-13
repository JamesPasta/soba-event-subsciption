import { and, eq, type SQL } from 'drizzle-orm';
import { EVENT_SUBSCRIPTION_SETTINGS_KEY, type EventSubscriptionSettings } from '@soba/lib';
import { db, type DbOrTx } from '../../../core/db/client';
import { formEventSubscriptions } from '../../../core/db/schema';
import {
  saveSettingsRow,
  type SettingsSaveActor,
  type SettingsSaveStatus,
} from '../../../core/db/repos/settingsRow';
import type { FormSettingsRowInput } from '../types';

export const createEventSubscription = async (
  input: FormSettingsRowInput,
  executor: DbOrTx,
): Promise<void> => {
  await executor.insert(formEventSubscriptions).values({
    workspaceId: input.workspaceId,
    formId: input.formId,
    createdBy: input.actorDisplayLabel,
    updatedBy: input.actorDisplayLabel,
  });
};

export const findEventSubscription = async (
  workspaceId: string,
  formId: string,
): Promise<EventSubscriptionSettings | null> => {
  const [row] = await db
    .select({
      endpointUrl: formEventSubscriptions.endpointUrl,
      key: formEventSubscriptions.key,
      encryptedToken: formEventSubscriptions.encryptedToken,
      version: formEventSubscriptions.version,
      updatedAt: formEventSubscriptions.updatedAt,
      updatedBy: formEventSubscriptions.updatedBy,
    })
    .from(formEventSubscriptions)
    .where(
      and(
        eq(formEventSubscriptions.workspaceId, workspaceId),
        eq(formEventSubscriptions.formId, formId),
      ),
    )
    .limit(1);
  return row
    ? {
        endpointUrl: row.endpointUrl,
        key: row.key,
        hasToken: row.encryptedToken !== null,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
      }
    : null;
};

export const findEncryptedEventSubscriptionToken = async (
  workspaceId: string,
  formId: string,
): Promise<string | null> => {
  const [row] = await db
    .select({ encryptedToken: formEventSubscriptions.encryptedToken })
    .from(formEventSubscriptions)
    .where(
      and(
        eq(formEventSubscriptions.workspaceId, workspaceId),
        eq(formEventSubscriptions.formId, formId),
      ),
    )
    .limit(1);
  return row?.encryptedToken ?? null;
};

export const updateEventSubscription = (input: {
  workspaceId: string;
  formId: string;
  endpointUrl: string;
  key: string;
  encryptedToken?: string;
  version: number;
  actorDisplayLabel: string | null;
  audit: SettingsSaveActor;
}): Promise<SettingsSaveStatus> =>
  saveSettingsRow(
    formEventSubscriptions,
    and(
      eq(formEventSubscriptions.workspaceId, input.workspaceId),
      eq(formEventSubscriptions.formId, input.formId),
    ) as SQL,
    {
      endpointUrl: input.endpointUrl,
      key: input.key,
      ...(input.encryptedToken !== undefined ? { encryptedToken: input.encryptedToken } : {}),
      updatedAt: new Date(),
      updatedBy: input.actorDisplayLabel,
    },
    input.version,
    {
      workspaceId: input.workspaceId,
      formId: input.formId,
      groupKey: EVENT_SUBSCRIPTION_SETTINGS_KEY,
      actorId: input.audit.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
    },
  );
