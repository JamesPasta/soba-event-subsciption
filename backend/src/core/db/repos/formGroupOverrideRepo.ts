import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { db, type DbOrTx } from '../client';
import { formGroupOverrideMembers, formGroupOverrides } from '../schema';
import { FormGroupOverrideStatus, GroupMemberKind, WorkspaceGroupMembershipStatus } from '../codes';

/** A member to write into a form's group override. */
export type OverrideMemberInput =
  | { kind: typeof GroupMemberKind.user; workspaceMembershipId: string }
  | { kind: typeof GroupMemberKind.idp; identityProviderCode: string }
  | { kind: typeof GroupMemberKind.idp_group; idpGroupCode: string };

/** True when the form has an active override for the group. */
export const hasActiveOverride = async (
  formId: string,
  groupId: string,
  executor?: DbOrTx,
): Promise<boolean> => {
  const ex = executor ?? db;
  const rows = await ex
    .select({ id: formGroupOverrides.id })
    .from(formGroupOverrides)
    .where(
      and(
        eq(formGroupOverrides.formId, formId),
        eq(formGroupOverrides.groupId, groupId),
        eq(formGroupOverrides.status, FormGroupOverrideStatus.active),
      ),
    )
    .limit(1);
  return rows.length > 0;
};

const memberRefs = (member: OverrideMemberInput) => {
  switch (member.kind) {
    case GroupMemberKind.user:
      return { workspaceMembershipId: member.workspaceMembershipId };
    case GroupMemberKind.idp:
      return { identityProviderCode: member.identityProviderCode };
    case GroupMemberKind.idp_group:
      return { idpGroupCode: member.idpGroupCode };
  }
};

/**
 * Sets a form's override of a group to exactly `members`, creating the override when the form has
 * none. The upsert creates or locks the active override in one statement, so concurrent writes for
 * the same form and group apply in turn, and a concurrent clear that commits first leaves this write
 * creating a new override.
 */
export const replaceOverrideMembers = async (args: {
  workspaceId: string;
  formId: string;
  groupId: string;
  members: OverrideMemberInput[];
  displayLabel: string | null;
  executor?: DbOrTx;
}): Promise<void> => {
  const executor = args.executor ?? db;
  await executor.transaction(async (tx) => {
    const [override] = await tx
      .insert(formGroupOverrides)
      .values({
        id: uuidv7(),
        workspaceId: args.workspaceId,
        formId: args.formId,
        groupId: args.groupId,
        status: FormGroupOverrideStatus.active,
        createdBy: args.displayLabel,
        updatedBy: args.displayLabel,
      })
      .onConflictDoUpdate({
        target: [formGroupOverrides.formId, formGroupOverrides.groupId],
        targetWhere: sql`${formGroupOverrides.status} = 'active'`,
        set: { updatedBy: args.displayLabel, updatedAt: new Date() },
      })
      .returning({ id: formGroupOverrides.id });

    await tx
      .delete(formGroupOverrideMembers)
      .where(eq(formGroupOverrideMembers.overrideId, override.id));
    if (args.members.length) {
      await tx.insert(formGroupOverrideMembers).values(
        args.members.map((member) => ({
          id: uuidv7(),
          workspaceId: args.workspaceId,
          overrideId: override.id,
          memberKind: member.kind,
          ...memberRefs(member),
          status: WorkspaceGroupMembershipStatus.active,
          createdBy: args.displayLabel,
          updatedBy: args.displayLabel,
        })),
      );
    }
  });
};

/** Removes a form's override of a group, so the form inherits the workspace group's members again. */
export const clearOverride = async (args: {
  formId: string;
  groupId: string;
  displayLabel: string | null;
  executor?: DbOrTx;
}): Promise<void> => {
  const executor = args.executor ?? db;
  await executor.transaction(async (tx) => {
    const [override] = await tx
      .select({ id: formGroupOverrides.id })
      .from(formGroupOverrides)
      .where(
        and(
          eq(formGroupOverrides.formId, args.formId),
          eq(formGroupOverrides.groupId, args.groupId),
          eq(formGroupOverrides.status, FormGroupOverrideStatus.active),
        ),
      )
      .for('update');
    if (!override) return;

    await tx
      .delete(formGroupOverrideMembers)
      .where(eq(formGroupOverrideMembers.overrideId, override.id));
    await tx
      .update(formGroupOverrides)
      .set({
        status: FormGroupOverrideStatus.inactive,
        updatedBy: args.displayLabel,
        updatedAt: new Date(),
      })
      .where(eq(formGroupOverrides.id, override.id));
  });
};
